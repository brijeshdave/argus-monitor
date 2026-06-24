/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for the audit-entry builder and deep secret redaction logic.
 */

import { describe, expect, it } from "vitest";
import {
  REDACTED,
  SECRET_KEY_PATTERN,
  buildAuditEntry,
  redact,
} from "@/audit.js";

// ---------------------------------------------------------------------------
// SECRET_KEY_PATTERN — sanity check the regex covers every required variant
// ---------------------------------------------------------------------------

describe("SECRET_KEY_PATTERN", () => {
  const mustMatch = [
    "password",
    "passwd",
    "clientSecret",
    "apiKey",
    "tokenHash",
    "ciphertext",
    "credential",
    "Authorization",
    // Edge-case capitalisation / embedded positions
    "PASSWORD",
    "refreshToken",
    "access_key",
    "CIPHER_IV",
    "userCredentials",
  ];

  const mustNotMatch = [
    "name",
    "email",
    "role",
    "action",
    "category",
    "status",
    "id",
    "ip",
  ];

  for (const k of mustMatch) {
    it(`matches "${k}"`, () => {
      expect(SECRET_KEY_PATTERN.test(k)).toBe(true);
    });
  }

  for (const k of mustNotMatch) {
    it(`does NOT match "${k}"`, () => {
      expect(SECRET_KEY_PATTERN.test(k)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// redact — core behaviour
// ---------------------------------------------------------------------------

describe("redact", () => {
  // --- Primitives pass through unchanged ---

  it("passes null through unchanged", () => {
    expect(redact(null)).toBeNull();
  });

  it("passes undefined through unchanged", () => {
    expect(redact(undefined)).toBeUndefined();
  });

  it("passes a string through unchanged", () => {
    expect(redact("hello")).toBe("hello");
  });

  it("passes a number through unchanged", () => {
    expect(redact(42)).toBe(42);
  });

  it("passes a boolean through unchanged", () => {
    expect(redact(false)).toBe(false);
  });

  // --- Top-level secret keys ---

  it("redacts a top-level 'password' key", () => {
    const result = redact({ password: "s3cret" }) as Record<string, unknown>;
    expect(result["password"]).toBe(REDACTED);
  });

  it("redacts 'passwd' (abbreviated variant)", () => {
    const result = redact({ passwd: "hunter2" }) as Record<string, unknown>;
    expect(result["passwd"]).toBe(REDACTED);
  });

  it("redacts 'clientSecret'", () => {
    const result = redact({ clientSecret: "abc" }) as Record<string, unknown>;
    expect(result["clientSecret"]).toBe(REDACTED);
  });

  it("redacts 'apiKey'", () => {
    const result = redact({ apiKey: "xyz" }) as Record<string, unknown>;
    expect(result["apiKey"]).toBe(REDACTED);
  });

  it("redacts 'tokenHash'", () => {
    const result = redact({ tokenHash: "hash" }) as Record<string, unknown>;
    expect(result["tokenHash"]).toBe(REDACTED);
  });

  it("redacts 'ciphertext'", () => {
    const result = redact({ ciphertext: "enc" }) as Record<string, unknown>;
    expect(result["ciphertext"]).toBe(REDACTED);
  });

  it("redacts 'credential'", () => {
    const result = redact({ credential: "cred" }) as Record<string, unknown>;
    expect(result["credential"]).toBe(REDACTED);
  });

  it("redacts 'Authorization' (case-insensitive match)", () => {
    const result = redact({ Authorization: "Bearer tok" }) as Record<
      string,
      unknown
    >;
    expect(result["Authorization"]).toBe(REDACTED);
  });

  // --- Non-secret keys are untouched ---

  it("does not redact non-secret keys", () => {
    const input = { name: "Alice", email: "alice@example.com", role: "admin" };
    const result = redact(input) as typeof input;
    expect(result.name).toBe("Alice");
    expect(result.email).toBe("alice@example.com");
    expect(result.role).toBe("admin");
  });

  // --- Null / undefined secret-key values stay as-is (not replaced by REDACTED) ---

  it("leaves a null value for a secret key as null", () => {
    const result = redact({ password: null }) as Record<string, unknown>;
    expect(result["password"]).toBeNull();
  });

  it("leaves an undefined value for a secret key as undefined", () => {
    const result = redact({ password: undefined }) as Record<string, unknown>;
    expect(result["password"]).toBeUndefined();
  });

  // --- Deep (nested) redaction ---

  it("redacts secret keys nested inside a plain object", () => {
    const input = {
      user: {
        id: "u1",
        password: "deep-secret",
      },
    };
    const result = redact(input) as { user: Record<string, unknown> };
    expect(result.user["id"]).toBe("u1");
    expect(result.user["password"]).toBe(REDACTED);
  });

  it("redacts secret keys inside objects nested in arrays", () => {
    const input = [{ apiKey: "k1", name: "svc-a" }, { apiKey: "k2", name: "svc-b" }];
    const result = redact(input) as Array<Record<string, unknown>>;
    expect(result[0]?.["apiKey"]).toBe(REDACTED);
    expect(result[0]?.["name"]).toBe("svc-a");
    expect(result[1]?.["apiKey"]).toBe(REDACTED);
    expect(result[1]?.["name"]).toBe("svc-b");
  });

  it("redacts deeply nested structures (3 levels)", () => {
    const input = {
      config: {
        db: {
          password: "pg-pass",
          host: "localhost",
        },
      },
    };
    const result = redact(input) as {
      config: { db: Record<string, unknown> };
    };
    expect(result.config.db["password"]).toBe(REDACTED);
    expect(result.config.db["host"]).toBe("localhost");
  });

  // --- Input must NOT be mutated ---

  it("does not mutate the original input object", () => {
    const original = { password: "original-secret", name: "Alice" };
    redact(original);
    // The original must remain untouched.
    expect(original.password).toBe("original-secret");
    expect(original.name).toBe("Alice");
  });

  it("does not mutate nested objects inside the input", () => {
    const inner = { tokenHash: "t123", role: "admin" };
    const original = { user: inner };
    redact(original);
    expect(inner.tokenHash).toBe("t123");
  });

  it("does not mutate array elements inside the input", () => {
    const item = { clientSecret: "s", id: "1" };
    const original = [item];
    redact(original);
    expect(item.clientSecret).toBe("s");
  });
});

// ---------------------------------------------------------------------------
// buildAuditEntry
// ---------------------------------------------------------------------------

describe("buildAuditEntry", () => {
  it("normalises all missing optional fields to null", () => {
    const entry = buildAuditEntry({ action: "user.create", category: "users" });
    expect(entry.actor).toBeNull();
    expect(entry.actorRole).toBeNull();
    expect(entry.target).toBeNull();
    expect(entry.before).toBeNull();
    expect(entry.after).toBeNull();
    expect(entry.ip).toBeNull();
  });

  it("normalises explicitly null optional fields to null", () => {
    const entry = buildAuditEntry({
      actor: null,
      actorRole: null,
      action: "user.delete",
      category: "users",
      target: null,
      ip: null,
    });
    expect(entry.actor).toBeNull();
    expect(entry.actorRole).toBeNull();
    expect(entry.target).toBeNull();
    expect(entry.ip).toBeNull();
  });

  it("preserves action and category exactly", () => {
    const entry = buildAuditEntry({
      action: "monitor.update",
      category: "monitors",
    });
    expect(entry.action).toBe("monitor.update");
    expect(entry.category).toBe("monitors");
  });

  it("preserves non-null scalar optional fields", () => {
    const entry = buildAuditEntry({
      actor: "u-99",
      actorRole: "admin",
      action: "secret.rotate",
      category: "secrets",
      target: "s-01",
      ip: "10.0.0.1",
    });
    expect(entry.actor).toBe("u-99");
    expect(entry.actorRole).toBe("admin");
    expect(entry.target).toBe("s-01");
    expect(entry.ip).toBe("10.0.0.1");
  });

  it("redacts secret fields in 'before'", () => {
    const entry = buildAuditEntry({
      action: "user.update",
      category: "users",
      before: { name: "Alice", password: "old-pass" },
    });
    const before = entry.before as Record<string, unknown>;
    expect(before["password"]).toBe(REDACTED);
    expect(before["name"]).toBe("Alice");
  });

  it("redacts secret fields in 'after'", () => {
    const entry = buildAuditEntry({
      action: "user.update",
      category: "users",
      after: { name: "Alice", apiKey: "new-key" },
    });
    const after = entry.after as Record<string, unknown>;
    expect(after["apiKey"]).toBe(REDACTED);
    expect(after["name"]).toBe("Alice");
  });

  it("redacts nested secrets in both before and after", () => {
    const entry = buildAuditEntry({
      action: "agent.register",
      category: "agents",
      before: { config: { tokenHash: "old-hash" } },
      after: { config: { tokenHash: "new-hash" } },
    });
    const before = entry.before as { config: Record<string, unknown> };
    const after = entry.after as { config: Record<string, unknown> };
    expect(before.config["tokenHash"]).toBe(REDACTED);
    expect(after.config["tokenHash"]).toBe(REDACTED);
  });

  it("leaves before/after as null when not provided", () => {
    const entry = buildAuditEntry({ action: "role.view", category: "roles" });
    expect(entry.before).toBeNull();
    expect(entry.after).toBeNull();
  });

  it("does not mutate the before/after inputs", () => {
    const before = { password: "secret", name: "Bob" };
    const after = { password: "new-secret", name: "Bob" };
    buildAuditEntry({
      action: "user.update",
      category: "users",
      before,
      after,
    });
    expect(before.password).toBe("secret");
    expect(after.password).toBe("new-secret");
  });
});
