import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  Forbidden,
  LastOwnerProtected,
  MemberNotInWorkspace,
  MembershipNotLive,
  Unauthorized,
} from "../errors";
import { Role } from "./roles";

const MemberMutationError = Schema.Union(
  Unauthorized,
  Forbidden,
  MemberNotInWorkspace,
  MembershipNotLive,
  LastOwnerProtected,
);

const MemberRow = Schema.Struct({
  membershipId: Id("workspaceMembers"),
  userId: Id("users"),
  email: Schema.String,
  role: Role,
  isCurrentActor: Schema.Boolean,
  status: Schema.Literal("pending", "active", "revoked"),
});

const DenialAuditArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  action: Schema.Literal(
    "member.roleChanged",
    "member.removed",
    "member.ownershipTransferred",
  ),
  subjectId: Schema.String,
  reason: Schema.String,
});

const list = FunctionSpec.publicQuery({
  name: "list",
  args: () => Schema.Struct({ workspaceId: Id("workspaces") }),
  returns: () => Schema.Array(MemberRow),
  error: () => Schema.Union(Unauthorized, Forbidden),
});

const changeRole = FunctionSpec.publicAction({
  name: "changeRole",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      membershipId: Id("workspaceMembers"),
      newRole: Role,
    }),
  returns: () => Schema.Null,
  error: () => MemberMutationError,
});

const changeRoleCore = FunctionSpec.internalMutation({
  name: "changeRoleCore",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      membershipId: Id("workspaceMembers"),
      newRole: Role,
    }),
  returns: () => Schema.Null,
  error: () => MemberMutationError,
});

const remove = FunctionSpec.publicAction({
  name: "remove",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      membershipId: Id("workspaceMembers"),
    }),
  returns: () => Schema.Null,
  error: () => MemberMutationError,
});

const removeCore = FunctionSpec.internalMutation({
  name: "removeCore",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      membershipId: Id("workspaceMembers"),
    }),
  returns: () => Schema.Null,
  error: () => MemberMutationError,
});

const transferOwnership = FunctionSpec.publicAction({
  name: "transferOwnership",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      membershipId: Id("workspaceMembers"),
    }),
  returns: () => Schema.Null,
  error: () => MemberMutationError,
});

const transferOwnershipCore = FunctionSpec.internalMutation({
  name: "transferOwnershipCore",
  args: () =>
    Schema.Struct({
      workspaceId: Id("workspaces"),
      membershipId: Id("workspaceMembers"),
    }),
  returns: () => Schema.Null,
  error: () => MemberMutationError,
});

const recordDenialAudit = FunctionSpec.internalMutation({
  name: "recordDenialAudit",
  args: () => DenialAuditArgs,
  returns: () => Schema.Null,
  error: () => Unauthorized,
});

export default GroupSpec.make()
  .addFunction(list)
  .addFunction(changeRole)
  .addFunction(changeRoleCore)
  .addFunction(remove)
  .addFunction(removeCore)
  .addFunction(transferOwnership)
  .addFunction(transferOwnershipCore)
  .addFunction(recordDenialAudit);
