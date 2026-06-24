/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Unit tests for the MIB parser — OID resolution from module text (SMI roots,
 * forward references, UNITS/DESCRIPTION capture, comment stripping).
 */
import { describe, it, expect } from "vitest";
import { parseMib } from "@/services/mib.js";

const MIB = `
QTEST-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;

-- vendor root
qnap        OBJECT IDENTIFIER ::= { enterprises 24681 }
systemInfo  OBJECT IDENTIFIER ::= { qnap 1 }

cpuTemp OBJECT-TYPE
  SYNTAX      INTEGER
  UNITS       "celsius"
  MAX-ACCESS  read-only
  STATUS      current
  DESCRIPTION "CPU temperature -- in celsius"
  ::= { systemInfo 5 }

-- forward reference: defined before its parent below
fanRpm OBJECT-TYPE SYNTAX INTEGER UNITS "rpm" ::= { cooling 1 }
cooling OBJECT IDENTIFIER ::= { qnap 2 }
END
`;

describe("parseMib", () => {
  it("resolves OIDs against SMI roots and nested parents", () => {
    const { objects } = parseMib(MIB);
    const byName = new Map(objects.map((o) => [o.name, o]));
    expect(byName.get("qnap")?.oid).toBe("1.3.6.1.4.1.24681");
    expect(byName.get("systemInfo")?.oid).toBe("1.3.6.1.4.1.24681.1");
    expect(byName.get("cpuTemp")?.oid).toBe("1.3.6.1.4.1.24681.1.5");
  });

  it("captures UNITS and DESCRIPTION, and strips comments inside them safely", () => {
    const cpu = parseMib(MIB).objects.find((o) => o.name === "cpuTemp");
    expect(cpu?.unit).toBe("celsius");
    expect(cpu?.description).toContain("CPU temperature");
  });

  it("resolves forward references (child defined before parent)", () => {
    const fan = parseMib(MIB).objects.find((o) => o.name === "fanRpm");
    expect(fan?.oid).toBe("1.3.6.1.4.1.24681.2.1");
    expect(fan?.unit).toBe("rpm");
  });
});
