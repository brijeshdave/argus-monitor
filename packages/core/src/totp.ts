/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * RFC 6238 Time-based One-Time Password (TOTP) and RFC 4648 Base32, implemented
 * with only node:crypto — no third-party 2FA library. Pure functions: no I/O, no
 * clock dependence except the optional `forTime`/`atTime` arguments (default now),
 * making the whole module trivially unit-testable.
 *
 * The shared secret is a base32 string. It is NEVER stored in plaintext by callers:
 * the 2FA service seals it with the AES-256-GCM envelope (see crypto.ts) before it
 * touches the database; recovery codes are stored only as SHA-256 hashes.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Base32 (RFC 4648, no padding, uppercase alphabet A–Z 2–7)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode bytes to a padding-free uppercase RFC 4648 base32 string. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // Flush the remaining < 5 bits, left-aligned (no "=" padding emitted).
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decode a base32 string back to bytes. Tolerant of lowercase, spaces and "="
 * padding (authenticator apps display the secret in grouped, padded form).
 * Throws on any character outside the alphabet.
 */
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: "${char}".`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Secret + code generation
// ---------------------------------------------------------------------------

/** Generate a fresh TOTP shared secret: 20 random bytes (160-bit) as base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Compute the TOTP code for a secret at a given time.
 *
 * @param secret  base32-encoded shared secret.
 * @param forTime Unix time in milliseconds (default `Date.now()`).
 * @param stepSec Time step in seconds (RFC 6238 default 30).
 * @param digits  Number of output digits (default 6).
 */
export function totpCode(
  secret: string,
  forTime: number = Date.now(),
  stepSec = 30,
  digits = 6,
): string {
  const counter = Math.floor(forTime / 1000 / stepSec);
  return hotp(base32Decode(secret), counter, digits);
}

/** Core HOTP (RFC 4226): HMAC-SHA1 over an 8-byte big-endian counter + dynamic truncation. */
function hotp(key: Buffer, counter: number, digits: number): string {
  const counterBuf = Buffer.alloc(8);
  // Write the (safe-integer) counter big-endian across the low 32 bits; the high
  // 32 bits stay zero, which is correct until well past the year 10000.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a submitted token against the secret, tolerating ±`window` time steps of
 * clock skew. Rejects non-numeric or wrong-length tokens up front, then compares
 * each candidate step in constant time to avoid leaking which step matched.
 */
export function verifyTotp(
  secret: string,
  token: string,
  atTime: number = Date.now(),
  window = 1,
  stepSec = 30,
  digits = 6,
): boolean {
  const trimmed = token.trim();
  if (trimmed.length !== digits || !/^\d+$/.test(trimmed)) return false;

  const submitted = Buffer.from(trimmed, "utf8");
  const counter = Math.floor(atTime / 1000 / stepSec);
  const key = base32Decode(secret);

  let matched = false;
  for (let offset = -window; offset <= window; offset++) {
    const candidate = Buffer.from(hotp(key, counter + offset, digits), "utf8");
    // Constant-time compare; OR into `matched` without early-return so the loop
    // runs a fixed number of iterations regardless of where a match occurs.
    if (candidate.length === submitted.length && timingSafeEqual(candidate, submitted)) {
      matched = true;
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// otpauth:// provisioning URI (consumed by authenticator apps / QR generators)
// ---------------------------------------------------------------------------

/** Build the otpauth:// URI an authenticator app imports (manually or via QR). */
export function otpauthUri(secret: string, account: string, issuer = "Argus"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    period: "30",
    digits: "6",
    algorithm: "SHA1",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Generate `n` human-readable recovery codes in `xxxx-xxxx` form (lowercase
 * base32 minus visually ambiguous characters). These are shown to the user ONCE;
 * only their SHA-256 hashes are persisted.
 */
export function generateRecoveryCodes(n = 10): string[] {
  // Drop 0/1/8/9/o/i/l-style ambiguity by using a curated alphabet.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const bytes = randomBytes(8);
    let s = "";
    for (let j = 0; j < 8; j++) {
      s += alphabet[bytes[j]! % alphabet.length];
      if (j === 3) s += "-";
    }
    codes.push(s);
  }
  return codes;
}
