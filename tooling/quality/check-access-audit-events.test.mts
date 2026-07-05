import { describe, expect, it } from "vitest";
import { evaluateAccessAuditEventSource } from "./check-access-audit-events.mts";

const membersFile = "packages/convex/confect/access/members.impl.ts";
const invitationsFile = "packages/convex/confect/access/invitations.impl.ts";

describe("check:access-audit-events", () => {
  it("requires member lifecycle impls to persist planner events", () => {
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
        message: expect.stringContaining("recordAccessLifecycleEvents"),
      }),
    );
  });

  it("requires invitation lifecycle impls to persist planner events", () => {
    const findings = evaluateAccessAuditEventSource(
      invitationsFile,
      `
        buildInvitationCreatedEvent();
        acceptInvitation();
        declineInvitation();
        cancelInvitation();
      `,
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("recordAccessLifecycleEvents"),
      }),
    );
  });

  it("requires one persistence call per planner in a lifecycle impl", () => {
    const findings = evaluateAccessAuditEventSource(
      invitationsFile,
      `
        buildInvitationCreatedEvent();
        acceptInvitation();
        declineInvitation();
        cancelInvitation();
        recordAccessLifecycleEvents(writer, events, now);
      `,
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("each access lifecycle planner event"),
      }),
    );
  });

  it("passes when all access lifecycle planners persist events", () => {
    expect(
      evaluateAccessAuditEventSource(
        membersFile,
        `
          changeMemberRole();
          recordAccessLifecycleEvents(writer, events, now);
          removeMember();
          recordAccessLifecycleEvents(writer, events, now);
          transferOwnership();
          recordAccessLifecycleEvents(writer, events, now);
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
          recordAccessLifecycleEvents(writer, events, now);
          recordAccessLifecycleEvents(writer, events, now);
          recordAccessLifecycleEvents(writer, events, now);
          recordAccessLifecycleEvents(writer, events, now);
        `,
      ),
    ).toEqual([]);
  });
});
