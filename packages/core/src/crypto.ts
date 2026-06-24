/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * AES-256-GCM secret encryption service with versioned envelopes and key-rotation support.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

// ---------------------------------------------------------------------------
// Envelope format
// ---------------------------------------------------------------------------
//
// All secrets are stored as a colon-delimited base64 string:
//
//   v1.<keyVersion>.<iv_b64>.<authTag_b64>.<ciphertext_b64>
//
// Parts:
//   [0] version    — literal "v1". Parsed first so we can add "v2" logic later
//                    without breaking old envelopes.
//   [1] keyVersion — monotonic integer identifying which master key was used.
//                    Lets rotation code find stale envelopes without decrypting them.
//   [2] iv_b64     — 12 random bytes (96-bit IV, NIST recommended for GCM).
//                    Freshly generated per encryption so repeated plaintexts
//                    produce different ciphertexts (IND-CPA).
//   [3] authTag_b64— 16-byte (128-bit) GCM authentication tag.
//                    GCM is an AEAD mode: the tag covers both the ciphertext AND
//                    the AAD (we use none here). Any single-bit flip in the ciphertext
//                    or tag causes decryption to throw before a byte of plaintext is
//                    returned, giving us tamper-evidence without a separate HMAC.
//   [4] ciphertext — AES-256 CTR-stream output, base64-encoded.
//
// Why GCM over CBC+HMAC?
//   • One primitive instead of two (no "Encrypt-then-MAC" ceremony to get wrong).
//   • Constant-time tag verification built into the OpenSSL binding.
//   • 12-byte IV is shorter and faster than a 16-byte CBC IV.
//
// Why a versioned envelope?
//   • Future cipher upgrades (v2: XChaCha20-Poly1305, etc.) can be added and
//     old envelopes decoded via a version dispatch table — zero forced-migration.
//   • keyVersion separates "which key" from "which algorithm", so we can rotate
//     the 32-byte master key without changing the cipher.

const ENVELOPE_VERSION = "v1" as const;
const SEPARATOR = ".";
const IV_BYTES = 12;   // 96-bit IV — NIST SP 800-38D recommended length for GCM
const TAG_BYTES = 16;  // 128-bit tag — full GCM tag length, strongest available
const KEY_BYTES = 32;  // AES-256 requires exactly 32 bytes
const ALGORITHM = "aes-256-gcm" as const;
const ENVELOPE_PARTS = 5;

// ---------------------------------------------------------------------------
// Key loading
// ---------------------------------------------------------------------------

/**
 * Decode a base64-encoded master key and validate its length.
 *
 * Usage:
 *   const key = loadKey(process.env.ENCRYPTION_KEY ?? "");
 *
 * Throws if the decoded key is not exactly 32 bytes (AES-256 requirement).
 */
export function loadKey(base64: string): Buffer {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    throw new Error("ENCRYPTION_KEY is not valid base64.");
  }
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (AES-256); ` +
        `got ${buf.length} bytes. Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Helper type
// ---------------------------------------------------------------------------

/** A thin wrapper type so callers can annotate storage fields semantically. */
export interface SealedSecret {
  envelope: string;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt `plaintext` under `key` and return a self-describing envelope string.
 *
 * @param plaintext  The secret value to protect (any UTF-8 string, including "").
 * @param key        A 32-byte Buffer loaded via `loadKey`.
 * @param keyVersion Monotonic integer identifying the key generation (default 1).
 *                   Increment when rotating the master key so old envelopes can be
 *                   found by `getEnvelopeKeyVersion` without decrypting them.
 * @returns          Envelope: `v1.<keyVersion>.<iv>.<tag>.<ciphertext>` (all base64).
 */
export function encryptSecret(
  plaintext: string,
  key: Buffer,
  keyVersion: number = 1,
): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes; got ${key.length}.`);
  }

  // Fresh random IV every call — critical for GCM security.
  // Reusing an IV with the same key leaks the XOR of plaintexts AND breaks
  // authentication (see "GCM nonce reuse catastrophe").
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  // Encrypt in two steps so we handle empty strings correctly.
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  // Must be called AFTER cipher.final() — only then is the tag finalised.
  const authTag = cipher.getAuthTag();

  const parts: string[] = [
    ENVELOPE_VERSION,
    String(keyVersion),
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ];

  return parts.join(SEPARATOR);
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Parse, verify, and decrypt an envelope produced by `encryptSecret`.
 *
 * Throws a descriptive Error on:
 *   • Malformed envelope (wrong part count, non-base64 segments)
 *   • Unsupported version prefix (only "v1" is understood today)
 *   • Authentication-tag mismatch — covers both ciphertext tampering and
 *     wrong key. Do NOT catch and swallow this: it means the data is corrupt
 *     or an attacker flipped bits.
 *
 * @returns The original plaintext UTF-8 string.
 */
export function decryptSecret(envelope: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes; got ${key.length}.`);
  }

  const parts = envelope.split(SEPARATOR);
  if (parts.length !== ENVELOPE_PARTS) {
    throw new Error(
      `Malformed envelope: expected ${ENVELOPE_PARTS} dot-separated parts, ` +
        `got ${parts.length}.`,
    );
  }

  // Length validated above, so a fixed-arity tuple is safe (avoids the
  // string|undefined widening from noUncheckedIndexedAccess).
  const [version, , ivB64, tagB64, ciphertextB64] = parts as [string, string, string, string, string];

  if (version !== ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported envelope version "${version}". Only "${ENVELOPE_VERSION}" is supported.`,
    );
  }

  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(ivB64, "base64");
    authTag = Buffer.from(tagB64, "base64");
    ciphertext = Buffer.from(ciphertextB64, "base64");
  } catch {
    throw new Error("Malformed envelope: one or more base64 segments are invalid.");
  }

  if (iv.length !== IV_BYTES) {
    throw new Error(
      `Malformed envelope: IV must be ${IV_BYTES} bytes; got ${iv.length}.`,
    );
  }
  if (authTag.length !== TAG_BYTES) {
    throw new Error(
      `Malformed envelope: auth tag must be ${TAG_BYTES} bytes; got ${authTag.length}.`,
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);

  // Set the tag BEFORE calling update/final — Node enforces this order.
  // If the tag doesn't match (wrong key, flipped bit, truncation) Node throws
  // an "Unsupported state or unable to authenticate data" error, which we let
  // propagate so callers cannot accidentally suppress it.
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),  // tag verification happens here
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    // Re-throw with a clearer message while preserving the original cause.
    throw new Error(
      "Decryption failed: authentication tag mismatch. " +
        "The envelope may be tampered with or the wrong key was used.",
      { cause: err },
    );
  }
}

// ---------------------------------------------------------------------------
// Key-version inspection (rotation helper)
// ---------------------------------------------------------------------------

/**
 * Extract the `keyVersion` from an envelope WITHOUT decrypting it.
 *
 * This is the first step of a rotation job:
 *   1. Scan all stored envelopes.
 *   2. Filter those where `getEnvelopeKeyVersion(env) < currentKeyVersion`.
 *   3. Call `rewrap(env, oldKey, newKey, newKeyVersion)` on each.
 *
 * Throws on malformed envelopes (same validation as `decryptSecret`).
 */
export function getEnvelopeKeyVersion(envelope: string): number {
  const parts = envelope.split(SEPARATOR);
  if (parts.length !== ENVELOPE_PARTS) {
    throw new Error(
      `Malformed envelope: expected ${ENVELOPE_PARTS} dot-separated parts, ` +
        `got ${parts.length}.`,
    );
  }

  const [version, keyVersionStr] = parts;

  if (version !== ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported envelope version "${version}". Only "${ENVELOPE_VERSION}" is supported.`,
    );
  }

  const keyVersion = Number(keyVersionStr);
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new Error(
      `Malformed envelope: keyVersion "${keyVersionStr}" is not a positive integer.`,
    );
  }

  return keyVersion;
}

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------

/**
 * Rotate an envelope from one master key to another without exposing the
 * plaintext to the caller's process any longer than necessary.
 *
 * Typical rotation flow:
 *   - Generate newKey = randomBytes(32).
 *   - Set ENCRYPTION_KEY_V2 in env / secrets manager.
 *   - Run a migration job: for each stored envelope call `rewrap(…)` and save.
 *   - Once all rows are migrated, retire the old key.
 *
 * @param envelope      Envelope sealed under `oldKey`.
 * @param oldKey        The key that sealed the envelope.
 * @param newKey        The replacement 32-byte key.
 * @param newKeyVersion The version integer to stamp on the new envelope (e.g. 2).
 * @returns             A new envelope sealed under `newKey` at `newKeyVersion`.
 */
export function rewrap(
  envelope: string,
  oldKey: Buffer,
  newKey: Buffer,
  newKeyVersion: number,
): string {
  const plaintext = decryptSecret(envelope, oldKey);
  return encryptSecret(plaintext, newKey, newKeyVersion);
}
