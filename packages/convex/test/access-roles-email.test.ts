import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  Role,
  capRole,
  highestRole,
  roleAtLeast,
} from "../confect/access/roles";
import { normalizeEmail } from "../confect/access/email";

describe("access role lattice", () => {
  it("orders roles as viewer < editor < admin < owner", () => {
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
    expect(roleAtLeast("editor", "viewer")).toBe(true);
    expect(roleAtLeast("admin", "editor")).toBe(true);
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("admin", "owner")).toBe(false);
  });

  it("caps roles to a maximum authority", () => {
    expect(capRole("owner", "admin")).toBe("admin");
    expect(capRole("editor", "admin")).toBe("editor");
    expect(capRole("viewer", "viewer")).toBe("viewer");
  });

  it("selects the highest present role", () => {
    expect(highestRole(["viewer", "admin", "editor"])).toBe("admin");
    expect(highestRole(["viewer"])).toBe("viewer");
    expect(highestRole([])).toBeUndefined();
  });

  it("rejects invalid roles at the schema boundary", () => {
    expect(Schema.decodeUnknownSync(Role)("owner")).toBe("owner");
    expect(() => Schema.decodeUnknownSync(Role)("superadmin")).toThrow();
  });
});

describe("access email normalization", () => {
  it("normalizes verified email values", () => {
    expect(normalizeEmail("  PERSON@Example.COM ")).toEqual({
      kind: "verified",
      email: "person@example.com",
    });
  });

  it("returns no verified email for blank input", () => {
    expect(normalizeEmail("   ")).toEqual({
      kind: "missing",
      reason: "blank",
    });
    expect(normalizeEmail(undefined)).toEqual({
      kind: "missing",
      reason: "missing",
    });
  });

  it("rejects malformed email input without guessing", () => {
    expect(normalizeEmail("not-an-email")).toEqual({
      kind: "invalid",
      input: "not-an-email",
    });
    expect(normalizeEmail("person@example")).toEqual({
      kind: "invalid",
      input: "person@example",
    });
  });
});
