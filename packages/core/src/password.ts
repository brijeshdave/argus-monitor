/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Password hashing using scrypt (memory-hard, built into Node — no third-party
 * dependency). Stored format is self-describing so parameters can evolve without
 * breaking existing hashes:  `scrypt$N$r$p$salt_b64$hash_b64`.
 *
 * Reused by the seed (owner bootstrap) and by auth — one implementation.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export interface ScryptParams {
  N: number; // CPU/memory cost (power of two)
  r: number; // block size
  p: number; // parallelization
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };

const KEY_LEN = 64;

/** Hash a plaintext password into the self-describing stored format. */
export function hashPassword(plaintext: string, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plaintext, salt, KEY_LEN, { N: params.N, r: params.r, p: params.p });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Verify a plaintext against a stored hash. Constant-time; never throws on mismatch. */
export function verifyPassword(plaintext: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr), r = Number(rStr), p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltB64!, "base64");
  const expected = Buffer.from(hashB64!, "base64");
  const actual = scryptSync(plaintext, salt, expected.length, { N, r, p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
