import { describe, expect, it } from "vitest";
import { evaluateAccessAuditEventSource } from "./check-access-audit-events.mts";

const membersFile = "packages/convex/confect/access/members.impl.ts";
const invitationsFile = "packages/convex/confect/access/invitations.impl.ts";

describe("check:access-audit-events", () => {
  it("requires member lifecycle impls to acknowledge planner events", () => {
    const findings = evaluateAccessAuditEventSource(
      membersFile,
      `
        changeMemberRole();
        removeMember();
        transferOwnership();
      `,
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("acknowledge access lifecycle events"),
      }),
    );
  });

  it("requires invitation lifecycle impls to preserve the temporary audit reason", () => {
    const findings = evaluateAccessAuditEventSource(
      invitationsFile,
      `
        buildInvitationCreatedEvent();
        acceptInvitation();
        declineInvitation();
        cancelInvitation();
        acknowledgeAccessLifecycleEvents(events, "other-reason");
      `,
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("audit-sink-not-yet-implemented"),
      }),
    );
  });

  it("passes when all access lifecycle planners have explicit event acknowledgement", () => {
    expect(
      evaluateAccessAuditEventSource(
        membersFile,
        `
          changeMemberRole();
          acknowledgeAccessLifecycleEvents(events, "audit-sink-not-yet-implemented");
          removeMember();
          transferOwnership();
        `,
      ),
    ).toEqual([]);
    expect(
      evaluateAccessAuditEventSource(
        invitationsFile,
        `
          buildInvitationCreatedEvent();
          acceptInvitation();
          declineInvitation();
          cancelInvitation();
          acknowledgeAccessLifecycleEvents(events, "audit-sink-not-yet-implemented");
        `,
      ),
    ).toEqual([]);
  });
});
