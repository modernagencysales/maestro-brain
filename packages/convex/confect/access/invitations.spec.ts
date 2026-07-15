import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  Forbidden,
  InvitationExpired,
  InvitationNotAccessible,
  InvitationNotPending,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { Role } from "./roles";

const InvitationRow = Schema.Struct({
  invitationId: Id("invitations"),
  email: Schema.String,
  role: Role,
  status: Schema.Literal(
    "pending",
    "accepted",
    "cancelled",
    "declined",
    "revoked",
    "expired",
  ),
  expiresAt: Schema.Number,
});

const InvitationDenialAuditArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  action: Schema.Literal("invitation.created", "invitation.cancelled"),
  subjectId: Schema.String,
  reason: Schema.String,
});

const list = FunctionSpec.publicQuery({
  name: "list",
  args: () => Schema.Struct({ workspaceId: Id("workspaces") }),
  returns: () => Schema.Array(InvitationRow),
  error: () => Schema.Union(Unauthorized, Forbidden),
});

const create = FunctionSpec.publicAction({
  name: "create",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      email: Schema.String,
      role: Role,
    }),
  returns: () => Id("invitations"),
  error: () =>
    Schema.Union(Unauthorized, Forbidden, ValidationFailed, WorkspaceNotFound),
});

const createCore = FunctionSpec.internalMutation({
  name: "createCore",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      email: Schema.String,
      role: Role,
    }),
  returns: () => Id("invitations"),
  error: () =>
    Schema.Union(Unauthorized, Forbidden, ValidationFailed, WorkspaceNotFound),
});

const accept = FunctionSpec.publicMutation({
  name: "accept",
  args: () =>
    Schema.Struct({
      invitationId: Id("invitations"),
    }),
  returns: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
    }),
  error: () =>
    Schema.Union(
      Unauthorized,
      InvitationNotAccessible,
      InvitationNotPending,
      InvitationExpired,
    ),
});

const decline = FunctionSpec.publicMutation({
  name: "decline",
  args: () =>
    Schema.Struct({
      invitationId: Id("invitations"),
    }),
  returns: () => Schema.Null,
  error: () => Schema.Union(Unauthorized, InvitationNotAccessible),
});

const cancel = FunctionSpec.publicAction({
  name: "cancel",
  args: () =>
    Schema.Struct({
      invitationId: Id("invitations"),
      workspaceId: Id("workspaces"),
    }),
  returns: () => Schema.Null,
  error: () => Schema.Union(Unauthorized, Forbidden),
});

const cancelCore = FunctionSpec.internalMutation({
  name: "cancelCore",
  args: () =>
    Schema.Struct({
      invitationId: Id("invitations"),
      workspaceId: Id("workspaces"),
    }),
  returns: () => Schema.Null,
  error: () => Schema.Union(Unauthorized, Forbidden),
});

const recordDenialAudit = FunctionSpec.internalMutation({
  name: "recordDenialAudit",
  args: () => InvitationDenialAuditArgs,
  returns: () => Schema.Null,
  error: () => Unauthorized,
});

export default GroupSpec.make()
  .addFunction(list)
  .addFunction(create)
  .addFunction(createCore)
  .addFunction(accept)
  .addFunction(decline)
  .addFunction(cancel)
  .addFunction(cancelCore)
  .addFunction(recordDenialAudit);
