/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for the AES-256-GCM secret-encryption service (crypto.ts).
 */

import { describe, it, expect } from "vitest";
import {
  loadKey,
  encryptSecret,
  decryptSecret,
  getEnvelopeKeyVersion,
  rewrap,
} from "@/crypto.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// A deterministic 32-byte test key — never use in production.
// Buffer.alloc fills with the given value byte; 0x07 × 32 = valid AES-256 key.
const TEST_KEY_A = Buffer.alloc(32, 0x07);

// A second, distinct 32-byte key for rotation tests.
const TEST_KEY_B = Buffer.alloc(32, 0x42);

// ---------------------------------------------------------------------------
// loadKey
// ---------------------------------------------------------------------------

describe("loadKey", () => {
  it("accepts a valid 32-byte base64-encoded key", () => {
    const b64 = Buffer.alloc(32, 0xab).toString("base64");
    const key = loadKey(b64);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("throws when the decoded length is less than 32 bytes", () => {
    const shortKey = Buffer.alloc(16, 0x01).toString("base64");
    expect(() => loadKey(shortKey)).toThrow(/32 bytes/);
  });

  it("throws when the decoded length is more than 32 bytes", () => {
    const longKey = Buffer.alloc(48, 0x01).toString("base64");
    expect(() => loadKey(longKey)).toThrow(/32 bytes/);
  });

  it("throws on an empty string", () => {
    expect(() => loadKey("")).toThrow(/32 bytes/);
  });

  it("round-trips through base64: decoded bytes match the original", () => {
    const original = Buffer.alloc(32, 0x55);
    const key = loadKey(original.toString("base64"));
    expect(key.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// encryptSecret / decryptSecret — round-trip
// ---------------------------------------------------------------------------

describe("encryptSecret + decryptSecret round-trip", () => {
  it("recovers a simple ASCII string", () => {
    const plain = "hello argus";
    const env = encryptSecret(plain, TEST_KEY_A);
    expect(decryptSecret(env, TEST_KEY_A)).toBe(plain);
  });

  it("recovers a unicode string (emoji, multibyte)", () => {
    const plain = "监控 🔐 — système";
    const env = encryptSecret(plain, TEST_KEY_A);
    expect(decryptSecret(env, TEST_KEY_A)).toBe(plain);
  });

  it("recovers an empty string", () => {
    const env = encryptSecret("", TEST_KEY_A);
    expect(decryptSecret(env, TEST_KEY_A)).toBe("");
  });

  it("recovers a long string (64 KB of data)", () => {
    const plain = "A".repeat(65_536);
    const env = encryptSecret(plain, TEST_KEY_A);
    expect(decryptSecret(env, TEST_KEY_A)).toBe(plain);
  });

  it("recovers a string that contains dots (which is the envelope separator)", () => {
    // Important: dots in the plaintext must not confuse envelope parsing,
    // because the plaintext is base64-encoded before being placed in the envelope.
    const plain = "v1.1.some.thing.tricky";
    const env = encryptSecret(plain, TEST_KEY_A);
    expect(decryptSecret(env, TEST_KEY_A)).toBe(plain);
  });

  it("the envelope has exactly 5 dot-separated parts", () => {
    const env = encryptSecret("test", TEST_KEY_A);
    expect(env.split(".").length).toBe(5);
  });

  it("the envelope starts with the version prefix 'v1'", () => {
    const env = encryptSecret("test", TEST_KEY_A);
    expect(env.startsWith("v1.")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Semantic non-determinism (random IV)
// ---------------------------------------------------------------------------

describe("IND-CPA: random IV produces unique ciphertexts", () => {
  it("two encryptions of the same plaintext differ", () => {
    const plain = "same-value";
    const env1 = encryptSecret(plain, TEST_KEY_A);
    const env2 = encryptSecret(plain, TEST_KEY_A);
    // Both must decrypt correctly …
    expect(decryptSecret(env1, TEST_KEY_A)).toBe(plain);
    expect(decryptSecret(env2, TEST_KEY_A)).toBe(plain);
    // … but must be distinct (probability of collision is 1 in 2^96).
    expect(env1).not.toBe(env2);
  });

  it("specifically, the IV segments differ across calls", () => {
    const env1 = encryptSecret("x", TEST_KEY_A);
    const env2 = encryptSecret("x", TEST_KEY_A);
    const iv1 = env1.split(".")[2];
    const iv2 = env2.split(".")[2];
    expect(iv1).not.toBe(iv2);
  });
});

// ---------------------------------------------------------------------------
// Tamper detection (GCM authentication tag)
// ---------------------------------------------------------------------------

describe("tamper detection", () => {
  /**
   * Helper: flip the last character of a base64 segment to a different char.
   * This alters the decoded bytes without making the string invalid base64
   * in all cases — but it definitely changes the underlying value.
   */
  function corruptSegment(env: string, segmentIndex: number): string {
    const parts = env.split(".");
    const seg = parts[segmentIndex];
    if (seg === undefined) throw new Error(`no segment at index ${segmentIndex}`);
    // Flip the FIRST char (not the last — base64 padding "=" at the end can decode
    // to identical bytes, leaving the segment effectively unchanged).
    const firstChar = seg[0];
    const replacement = firstChar === "A" ? "B" : "A";
    parts[segmentIndex] = replacement + seg.slice(1);
    return parts.join(".");
  }

  it("throws when the ciphertext segment is modified", () => {
    const env = encryptSecret("secret data", TEST_KEY_A);
    const tampered = corruptSegment(env, 4); // index 4 = ciphertext
    expect(() => decryptSecret(tampered, TEST_KEY_A)).toThrow();
  });

  it("throws when the auth-tag segment is modified", () => {
    const env = encryptSecret("secret data", TEST_KEY_A);
    const tampered = corruptSegment(env, 3); // index 3 = auth tag
    expect(() => decryptSecret(tampered, TEST_KEY_A)).toThrow();
  });

  it("throws when the IV segment is modified (IV mismatch ⇒ wrong decryption ⇒ tag fails)", () => {
    const env = encryptSecret("secret data", TEST_KEY_A);
    const tampered = corruptSegment(env, 2); // index 2 = IV
    expect(() => decryptSecret(tampered, TEST_KEY_A)).toThrow();
  });

  it("error message describes the authentication failure", () => {
    const env = encryptSecret("secret data", TEST_KEY_A);
    const tampered = corruptSegment(env, 4);
    expect(() => decryptSecret(tampered, TEST_KEY_A)).toThrow(
      /authentication tag mismatch|Decryption failed/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Wrong-key rejection
// ---------------------------------------------------------------------------

describe("wrong key", () => {
  it("throws when decrypting with a different 32-byte key", () => {
    const env = encryptSecret("classified", TEST_KEY_A);
    expect(() => decryptSecret(env, TEST_KEY_B)).toThrow();
  });

  it("throws when decrypting with an all-zero key", () => {
    const zeroKey = Buffer.alloc(32, 0x00);
    const env = encryptSecret("classified", TEST_KEY_A);
    expect(() => decryptSecret(env, zeroKey)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Malformed envelope parsing
// ---------------------------------------------------------------------------

describe("malformed envelope", () => {
  it("throws on a plain garbage string", () => {
    expect(() => decryptSecret("garbage", TEST_KEY_A)).toThrow(/Malformed/);
  });

  it("throws when the envelope has too few parts (3 dots instead of 4)", () => {
    expect(() => decryptSecret("v1.1.aaa.bbb", TEST_KEY_A)).toThrow(/Malformed/);
  });

  it("throws when the envelope has too many parts (5 dots)", () => {
    expect(() =>
      decryptSecret("v1.1.aaa.bbb.ccc.extra", TEST_KEY_A),
    ).toThrow(/Malformed/);
  });

  it("throws when the version prefix is 'v2' (unsupported)", () => {
    // Build a structurally-valid envelope but swap the version.
    const good = encryptSecret("hi", TEST_KEY_A);
    const parts = good.split(".");
    parts[0] = "v2";
    expect(() => decryptSecret(parts.join("."), TEST_KEY_A)).toThrow(
      /Unsupported envelope version/,
    );
  });

  it("throws when the version prefix is an empty string", () => {
    const good = encryptSecret("hi", TEST_KEY_A);
    const parts = good.split(".");
    parts[0] = "";
    expect(() => decryptSecret(parts.join("."), TEST_KEY_A)).toThrow(
      /Unsupported envelope version/,
    );
  });

  it("throws on an empty envelope string", () => {
    expect(() => decryptSecret("", TEST_KEY_A)).toThrow(/Malformed/);
  });
});

// ---------------------------------------------------------------------------
// keyVersion stamping
// ---------------------------------------------------------------------------

describe("getEnvelopeKeyVersion", () => {
  it("returns 1 (the default) when no keyVersion is supplied to encryptSecret", () => {
    const env = encryptSecret("val", TEST_KEY_A);
    expect(getEnvelopeKeyVersion(env)).toBe(1);
  });

  it("returns the explicit keyVersion supplied to encryptSecret", () => {
    const env = encryptSecret("val", TEST_KEY_A, 7);
    expect(getEnvelopeKeyVersion(env)).toBe(7);
  });

  it("returns the correct version for keyVersion=99", () => {
    const env = encryptSecret("val", TEST_KEY_A, 99);
    expect(getEnvelopeKeyVersion(env)).toBe(99);
  });

  it("throws on a garbage string", () => {
    expect(() => getEnvelopeKeyVersion("not-an-envelope")).toThrow(/Malformed/);
  });

  it("throws on an unsupported version prefix", () => {
    const good = encryptSecret("x", TEST_KEY_A);
    const parts = good.split(".");
    parts[0] = "v2";
    expect(() => getEnvelopeKeyVersion(parts.join("."))).toThrow(
      /Unsupported envelope version/,
    );
  });
});

// ---------------------------------------------------------------------------
// rewrap (key rotation)
// ---------------------------------------------------------------------------

describe("rewrap", () => {
  it("produces an envelope decryptable with the new key", () => {
    const plain = "rotate-me";
    const original = encryptSecret(plain, TEST_KEY_A, 1);
    const rotated = rewrap(original, TEST_KEY_A, TEST_KEY_B, 2);
    expect(decryptSecret(rotated, TEST_KEY_B)).toBe(plain);
  });

  it("stamps the new keyVersion on the rewrapped envelope", () => {
    const original = encryptSecret("x", TEST_KEY_A, 1);
    const rotated = rewrap(original, TEST_KEY_A, TEST_KEY_B, 2);
    expect(getEnvelopeKeyVersion(rotated)).toBe(2);
  });

  it("the rewrapped envelope can no longer be decrypted with the old key", () => {
    const original = encryptSecret("x", TEST_KEY_A, 1);
    const rotated = rewrap(original, TEST_KEY_A, TEST_KEY_B, 2);
    expect(() => decryptSecret(rotated, TEST_KEY_A)).toThrow();
  });

  it("produces a different ciphertext than the original (new IV, new key)", () => {
    const original = encryptSecret("rotate-me", TEST_KEY_A, 1);
    const rotated = rewrap(original, TEST_KEY_A, TEST_KEY_B, 2);
    expect(rotated).not.toBe(original);
  });

  it("rewrapping to the same key at a new version works and the plaintext is preserved", () => {
    const plain = "same-key-rotate";
    const original = encryptSecret(plain, TEST_KEY_A, 1);
    const rotated = rewrap(original, TEST_KEY_A, TEST_KEY_A, 3);
    expect(decryptSecret(rotated, TEST_KEY_A)).toBe(plain);
    expect(getEnvelopeKeyVersion(rotated)).toBe(3);
  });

  it("throws when rewrap is called with the wrong old key", () => {
    const original = encryptSecret("x", TEST_KEY_A, 1);
    // Pass KEY_B as the "old" key — decryption of the original should fail.
    expect(() => rewrap(original, TEST_KEY_B, TEST_KEY_A, 2)).toThrow();
  });

  it("handles unicode plaintext through a full rotation cycle", () => {
    const plain = "секрет 🔑";
    const original = encryptSecret(plain, TEST_KEY_A, 1);
    const rotated = rewrap(original, TEST_KEY_A, TEST_KEY_B, 2);
    expect(decryptSecret(rotated, TEST_KEY_B)).toBe(plain);
  });
});
