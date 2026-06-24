/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for the pure RBAC + ABAC authorization evaluator (authorize.ts).
 */

import { describe, it, expect } from "vitest";
import {
  hasPermission,
  satisfiesAttributes,
  authorize,
  can,
  type AuthSubject,
  type ResourceContext,
} from "@/authorize.js";

// ---------------------------------------------------------------------------
// Subject factories — keep tests DRY and intention-revealing
// ---------------------------------------------------------------------------

/** A regular (non-owner) subject with the given permissions and no attributes. */
function makeSubject(permissions: string[] = []): AuthSubject {
  return {
    userId: "user-1",
    isOwner: false,
    permissions,
    attributes: [],
  };
}

/** Extend a base subject with ABAC attributes. */
function withAttributes(
  subject: AuthSubject,
  attrs: { key: string; value: string }[],
): AuthSubject {
  return { ...subject, attributes: attrs };
}

/** The protected owner — no permissions needed. */
const ownerSubject: AuthSubject = {
  userId: "owner-0",
  isOwner: true,
  permissions: [],
  attributes: [],
};

// ---------------------------------------------------------------------------
// hasPermission
// ---------------------------------------------------------------------------

describe("hasPermission", () => {
  it("returns true when the action is in the permission set", () => {
    const s = makeSubject(["agents:read", "agents:write"]);
    expect(hasPermission(s, "agents:read")).toBe(true);
  });

  it("returns false when the action is absent", () => {
    const s = makeSubject(["agents:read"]);
    expect(hasPermission(s, "agents:write")).toBe(false);
  });

  it("returns false for an empty permission set", () => {
    expect(hasPermission(makeSubject(), "agents:read")).toBe(false);
  });

  it("is case-sensitive (normalised keys must match exactly)", () => {
    const s = makeSubject(["agents:read"]);
    expect(hasPermission(s, "Agents:Read")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// satisfiesAttributes
// ---------------------------------------------------------------------------

describe("satisfiesAttributes", () => {
  it("returns true when no required attributes are given (undefined)", () => {
    expect(satisfiesAttributes(makeSubject(), undefined)).toBe(true);
  });

  it("returns true for an empty required record", () => {
    expect(satisfiesAttributes(makeSubject(), {})).toBe(true);
  });

  it("exact-match: returns true when subject has the required attribute value", () => {
    const s = withAttributes(makeSubject(), [{ key: "site", value: "plant-a" }]);
    expect(satisfiesAttributes(s, { site: "plant-a" })).toBe(true);
  });

  it("exact-match: returns false when value differs", () => {
    const s = withAttributes(makeSubject(), [{ key: "site", value: "plant-b" }]);
    expect(satisfiesAttributes(s, { site: "plant-a" })).toBe(false);
  });

  it("exact-match: returns false when the required key is missing from subject", () => {
    const s = makeSubject(); // no attributes
    expect(satisfiesAttributes(s, { site: "plant-a" })).toBe(false);
  });

  it("one-of: returns true when subject value is in the allowed list", () => {
    const s = withAttributes(makeSubject(), [{ key: "region", value: "eu" }]);
    expect(satisfiesAttributes(s, { region: ["us", "eu"] })).toBe(true);
  });

  it("one-of: returns false when subject value is not in the allowed list", () => {
    const s = withAttributes(makeSubject(), [{ key: "region", value: "apac" }]);
    expect(satisfiesAttributes(s, { region: ["us", "eu"] })).toBe(false);
  });

  it("multiple required keys: all must be satisfied", () => {
    const s = withAttributes(makeSubject(), [
      { key: "site", value: "plant-a" },
      { key: "region", value: "eu" },
    ]);
    expect(satisfiesAttributes(s, { site: "plant-a", region: "eu" })).toBe(true);
  });

  it("multiple required keys: one missing key causes failure", () => {
    // subject only has 'site', not 'region'
    const s = withAttributes(makeSubject(), [{ key: "site", value: "plant-a" }]);
    expect(satisfiesAttributes(s, { site: "plant-a", region: "eu" })).toBe(false);
  });

  it("multiple required keys: one wrong value causes failure", () => {
    const s = withAttributes(makeSubject(), [
      { key: "site", value: "plant-a" },
      { key: "region", value: "apac" }, // wrong
    ]);
    expect(satisfiesAttributes(s, { site: "plant-a", region: "eu" })).toBe(false);
  });

  it("satisfies when subject has multiple attributes for same key and one matches", () => {
    // A subject might have multiple site memberships
    const s = withAttributes(makeSubject(), [
      { key: "site", value: "plant-b" },
      { key: "site", value: "plant-a" },
    ]);
    expect(satisfiesAttributes(s, { site: "plant-a" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// authorize — decision ordering
// ---------------------------------------------------------------------------

describe("authorize — owner bypass", () => {
  it("allows the owner with no permissions and returns owner_bypass", () => {
    const result = authorize(ownerSubject, "monitors:delete");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner_bypass");
  });

  it("owner bypass is unconditional even with unsatisfied ABAC constraints", () => {
    // Owner has no site attribute but resource requires one
    const resource: ResourceContext = {
      requiredAttributes: { site: "plant-a" },
    };
    const result = authorize(ownerSubject, "monitors:delete", resource);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner_bypass");
  });

  it("owner bypass works for any action string", () => {
    expect(authorize(ownerSubject, "totally:made-up:action").reason).toBe("owner_bypass");
  });
});

describe("authorize — missing_permission", () => {
  it("denies a non-owner who lacks the permission", () => {
    const s = makeSubject(["agents:read"]);
    const result = authorize(s, "agents:write");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_permission");
  });

  it("denies a subject with an empty permission set", () => {
    const result = authorize(makeSubject(), "monitors:read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_permission");
  });

  it("missing_permission is returned even when attribute constraints would also fail", () => {
    // Permission is absent — that's reported first; ABAC is never reached.
    const s = withAttributes(makeSubject(["agents:read"]), [
      { key: "site", value: "plant-b" },
    ]);
    const resource: ResourceContext = {
      requiredAttributes: { site: "plant-a" },
    };
    const result = authorize(s, "monitors:write", resource); // wrong permission
    expect(result.reason).toBe("missing_permission");
  });
});

describe("authorize — attribute_mismatch", () => {
  it("denies when permission is held but ABAC attributes are unmet", () => {
    const s = withAttributes(makeSubject(["monitors:read"]), [
      { key: "site", value: "plant-b" },
    ]);
    const resource: ResourceContext = {
      requiredAttributes: { site: "plant-a" },
    };
    const result = authorize(s, "monitors:read", resource);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("attribute_mismatch");
  });

  it("denies when one of multiple required attribute keys is missing", () => {
    const s = withAttributes(makeSubject(["monitors:read"]), [
      { key: "site", value: "plant-a" },
      // 'region' attribute not present
    ]);
    const resource: ResourceContext = {
      requiredAttributes: { site: "plant-a", region: "eu" },
    };
    const result = authorize(s, "monitors:read", resource);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("attribute_mismatch");
  });

  it("denies one-of constraint when value is not in the list", () => {
    const s = withAttributes(makeSubject(["monitors:read"]), [
      { key: "region", value: "apac" },
    ]);
    const resource: ResourceContext = {
      requiredAttributes: { region: ["us", "eu"] },
    };
    const result = authorize(s, "monitors:read", resource);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("attribute_mismatch");
  });
});

describe("authorize — granted", () => {
  it("allows a non-owner who holds the permission and no ABAC constraints apply", () => {
    const s = makeSubject(["monitors:read"]);
    const result = authorize(s, "monitors:read");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("granted");
  });

  it("allows when permission held and resource has no requiredAttributes", () => {
    const s = makeSubject(["monitors:write"]);
    const result = authorize(s, "monitors:write", { ownerUserId: "user-2" });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("granted");
  });

  it("allows when permission held and resource passes with empty requiredAttributes", () => {
    const s = makeSubject(["agents:read"]);
    const result = authorize(s, "agents:read", { requiredAttributes: {} });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("granted");
  });

  it("allows when all ABAC attribute constraints are satisfied", () => {
    const s = withAttributes(makeSubject(["monitors:read"]), [
      { key: "site", value: "plant-a" },
      { key: "region", value: "eu" },
    ]);
    const resource: ResourceContext = {
      requiredAttributes: { site: "plant-a", region: ["us", "eu"] },
    };
    const result = authorize(s, "monitors:read", resource);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("granted");
  });

  it("allows when no resource context is provided at all", () => {
    const s = makeSubject(["settings:read"]);
    const result = authorize(s, "settings:read");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("granted");
  });
});

// ---------------------------------------------------------------------------
// can — convenience boolean wrapper
// ---------------------------------------------------------------------------

describe("can", () => {
  it("returns true when authorize would allow", () => {
    const s = makeSubject(["agents:read"]);
    expect(can(s, "agents:read")).toBe(true);
  });

  it("returns false when authorize would deny (missing permission)", () => {
    expect(can(makeSubject(), "agents:read")).toBe(false);
  });

  it("returns true for the owner regardless of action", () => {
    expect(can(ownerSubject, "agents:delete")).toBe(true);
  });

  it("returns false on attribute_mismatch", () => {
    const s = withAttributes(makeSubject(["monitors:read"]), [
      { key: "site", value: "plant-b" },
    ]);
    expect(can(s, "monitors:read", { requiredAttributes: { site: "plant-a" } })).toBe(false);
  });

  it("mirrors authorize(...).allowed exactly across all outcomes", () => {
    const cases: Array<[AuthSubject, string, ResourceContext?]> = [
      [ownerSubject, "anything:delete"],
      [makeSubject(["x:read"]), "x:read"],
      [makeSubject(), "x:read"],
      [
        withAttributes(makeSubject(["x:read"]), [{ key: "k", value: "wrong" }]),
        "x:read",
        { requiredAttributes: { k: "right" } },
      ],
    ];

    for (const [subject, action, resource] of cases) {
      expect(can(subject, action, resource)).toBe(
        authorize(subject, action, resource).allowed,
      );
    }
  });
});
