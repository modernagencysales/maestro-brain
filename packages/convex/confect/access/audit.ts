import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { DatabaseWriter } from "../_generated/services";
import type { AccessLifecycleEvent } from "./lifecycle";

export const privilegedAccessAuditActions = [
  "member.roleChanged",
  "member.removed",
  "member.ownershipTransferred",
  "invitation.created",
  "invitation.accepted",
  "invitation.declined",
  "invitation.cancelled",
  "slack.connectionChanged",
  "slack.channelPolicyChanged",
  "retention.policyChanged",
  "model.egressPolicyChanged",
  "autopilot.policyChanged",
  "export.administered",
  "apiKey.administered",
] as const;

export type PrivilegedAccessAuditAction =
  (typeof privilegedAccessAuditActions)[number];

type PrivilegedAccessAuditEvent = {
  readonly workspaceId: string;
  readonly action: PrivilegedAccessAuditAction;
  readonly actorUserId?: string;
  readonly actorEmail?: string;
  readonly subjectKind: "workspaceMember" | "invitation" | "privilegedAction";
  readonly subjectId: string;
  readonly metadata: Record<string, string | number | boolean>;
};

type AccessAuditEvent = AccessLifecycleEvent | PrivilegedAccessAuditEvent;

export type AccessAuditEventInsert = {
  readonly workspaceId: string;
  readonly action: AccessAuditEvent["action"];
  readonly actorUserId?: string;
  readonly actorEmail?: string;
  readonly subjectKind: AccessAuditEvent["subjectKind"];
  readonly subjectId: string;
  readonly metadataJson: string;
  readonly createdAt: number;
};

type Writer = Context.Tag.Service<typeof DatabaseWriter>;

export const accessAuditEventInsert = (
  event: AccessAuditEvent,
  createdAt: number,
): AccessAuditEventInsert => ({
  workspaceId: event.workspaceId,
  action: event.action,
  ...("actorUserId" in event ? { actorUserId: event.actorUserId } : {}),
  ...("actorEmail" in event ? { actorEmail: event.actorEmail } : {}),
  subjectKind: event.subjectKind,
  subjectId: event.subjectId,
  metadataJson: JSON.stringify(event.metadata),
  createdAt,
});

export const recordAccessLifecycleEvents = (
  writer: Writer,
  events: readonly AccessLifecycleEvent[],
  createdAt: number,
): Effect.Effect<void, never> =>
  Effect.forEach(events, (event) =>
    writer
      .table("accessAuditEvents")
      .insert(accessAuditEventInsert(event, createdAt))
      .pipe(Effect.orDie),
  ).pipe(Effect.asVoid);
