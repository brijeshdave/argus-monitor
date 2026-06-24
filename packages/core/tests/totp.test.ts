/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Tests for the RFC 6238 TOTP + RFC 4648 base32 primitives. Covers a published
 * RFC 6238 test vector, base32 round-trips, generate-then-verify, clock-skew
 * window behaviour, and rejection of malformed tokens.
 */
import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  otpauthUri,
  generateRecoveryCodes,
} from "@/totp.js";

// The RFC 6238 reference secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const sample of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      const buf = Buffer.from(sample, "ascii");
      expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    }
  });

  it("tolerates lowercase, spaces and padding on decode", () => {
    const buf = Buffer.from("foobar", "ascii");
    const enc = base32Encode(buf).toLowerCase();
    expect(base32Decode(`${enc}===`).equals(buf)).toBe(true);
    expect(base32Decode(enc.replace(/(.)/g, "$1 ")).equals(buf)).toBe(true);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("!!!")).toThrow();
  });
});

describe("totpCode (RFC 6238 vector)", () => {
  it("matches the published SHA-1 6-digit code at T=59s", () => {
    // RFC 6238 Appendix B: time 59 → counter 1 → "94287082" (8 digits, SHA1).
    // Truncated to 6 digits that is the trailing "287082".
    expect(totpCode(RFC_SECRET, 59 * 1000, 30, 8)).toBe("94287082");
    expect(totpCode(RFC_SECRET, 59 * 1000)).toBe("287082");
  });

  it("matches another published step (T=1111111109s)", () => {
    expect(totpCode(RFC_SECRET, 1111111109 * 1000, 30, 8)).toBe("07081804");
  });
});

describe("verifyTotp", () => {
  it("accepts a freshly generated code", () => {
    const secret = generateTotpSecret();
    const t = Date.now();
    expect(verifyTotp(secret, totpCode(secret, t), t)).toBe(true);
  });

  it("rejects the wrong code", () => {
    const secret = generateTotpSecret();
    const t = Date.now();
    const right = totpCode(secret, t);
    const wrong = right === "000000" ? "111111" : "000000";
    expect(verifyTotp(secret, wrong, t)).toBe(false);
  });

  it("accepts a code one step away (clock skew) within the window", () => {
    const secret = generateTotpSecret();
    const t = 1_000_000_000_000;
    const prevStep = totpCode(secret, t - 30_000);
    expect(verifyTotp(secret, prevStep, t, 1)).toBe(true);
  });

  it("rejects a code outside the window", () => {
    const secret = generateTotpSecret();
    const t = 1_000_000_000_000;
    const farStep = totpCode(secret, t - 90_000); // 3 steps back
    expect(verifyTotp(secret, farStep, t, 1)).toBe(false);
  });

  it("rejects non-numeric and wrong-length tokens", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "abcdef")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
    expect(verifyTotp(secret, "1234567")).toBe(false);
  });
});

describe("otpauthUri", () => {
  it("emits a well-formed otpauth:// URI", () => {
    const uri = otpauthUri("ABCDEF", "alice@example.com", "Argus");
    expect(uri).toContain("otpauth://totp/Argus:alice%40example.com");
    expect(uri).toContain("secret=ABCDEF");
    expect(uri).toContain("issuer=Argus");
    expect(uri).toContain("period=30");
    expect(uri).toContain("algorithm=SHA1");
  });
});

describe("generateRecoveryCodes", () => {
  it("produces n unique xxxx-xxxx codes", () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});
