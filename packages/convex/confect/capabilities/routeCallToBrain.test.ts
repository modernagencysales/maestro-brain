import { describe, expect, it } from "vitest";

import { matchCall } from "../routing/callMatching";

const mapping = (
  kind: "recurring_meeting" | "email" | "domain" | "stakeholder",
  value: string,
  brainKey: string,
  organizationKey = "org_agency",
) => ({ kind, value, brainKey, organizationKey });

describe("call-to-Brain exact matching", () => {
  it("matches one participant domain", () => {
    expect(
      matchCall({
        organizationKey: "org_agency",
        allowedBrainKeys: ["br_acme"],
        participants: [{ email: "buyer@acme.com", domain: "acme.com" }],
        mappings: [mapping("domain", "acme.com", "br_acme")],
      }),
    ).toEqual({
      kind: "exact",
      brainKey: "br_acme",
      reason: "participant_domain",
    });
  });

  it("rejects calls spanning multiple mapped clients", () => {
    expect(
      matchCall({
        organizationKey: "org_agency",
        allowedBrainKeys: ["br_acme", "br_globex"],
        participants: [
          { email: "a@acme.com", domain: "acme.com" },
          { email: "b@globex.com", domain: "globex.com" },
        ],
        mappings: [
          mapping("domain", "acme.com", "br_acme"),
          mapping("domain", "globex.com", "br_globex"),
        ],
      }),
    ).toEqual({ kind: "mixed_client", brainKeys: ["br_acme", "br_globex"] });
  });

  it("uses recurring meeting, email, domain, then stakeholder precedence", () => {
    const input = {
      organizationKey: "org_agency",
      allowedBrainKeys: ["br_recurrence", "br_email", "br_domain", "br_person"],
      recurringMeetingId: "series_1",
      participants: [{ email: "buyer@acme.com", domain: "acme.com" }],
      mappings: [
        mapping("stakeholder", "buyer@acme.com", "br_person"),
        mapping("domain", "acme.com", "br_domain"),
        mapping("email", "buyer@acme.com", "br_email"),
        mapping("recurring_meeting", "series_1", "br_recurrence"),
      ],
    } as const;

    expect(matchCall(input)).toEqual({
      kind: "exact",
      brainKey: "br_recurrence",
      reason: "recurring_meeting",
    });
  });

  it("ignores foreign-organization and disallowed-Brain mappings", () => {
    expect(
      matchCall({
        organizationKey: "org_agency",
        allowedBrainKeys: ["br_acme"],
        participants: [{ email: "buyer@acme.com", domain: "acme.com" }],
        mappings: [
          mapping("domain", "acme.com", "br_foreign", "org_foreign"),
          mapping("email", "buyer@acme.com", "br_not_allowed"),
        ],
      }),
    ).toEqual({ kind: "no_match" });
  });

  it("classifies calls with only agency participants without routing", () => {
    expect(
      matchCall({
        organizationKey: "org_agency",
        allowedBrainKeys: ["br_acme"],
        agencyDomains: ["maestrogtm.com"],
        participants: [
          { email: "alex@maestrogtm.com", domain: "maestrogtm.com" },
        ],
        mappings: [],
      }),
    ).toEqual({ kind: "agency_internal" });
  });
});
