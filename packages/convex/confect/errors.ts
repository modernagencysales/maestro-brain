import * as Schema from "effect/Schema";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  reason: Schema.String,
}) {}

export class MemberNotInWorkspace extends Schema.TaggedError<MemberNotInWorkspace>()(
  "MemberNotInWorkspace",
  {
    membershipId: Schema.String,
  },
) {}

/**
 * The membership row belongs to the workspace but is not live (pending, revoked,
 * or soft-deleted). Distinct from MemberNotInWorkspace — "exists here but can't
 * act" is a different client-facing case than "not a member of this workspace".
 */
export class MembershipNotLive extends Schema.TaggedError<MembershipNotLive>()(
  "MembershipNotLive",
  {
    membershipId: Schema.String,
  },
) {}

export class LastOwnerProtected extends Schema.TaggedError<LastOwnerProtected>()(
  "LastOwnerProtected",
  {
    workspaceId: Schema.String,
  },
) {}

export class InvitationNotAccessible extends Schema.TaggedError<InvitationNotAccessible>()(
  "InvitationNotAccessible",
  {},
) {}

export class InvitationNotPending extends Schema.TaggedError<InvitationNotPending>()(
  "InvitationNotPending",
  {
    invitationId: Schema.String,
  },
) {}

export class InvitationExpired extends Schema.TaggedError<InvitationExpired>()(
  "InvitationExpired",
  {
    invitationId: Schema.String,
  },
) {}

export class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()(
  "WorkspaceNotFound",
  {
    workspaceId: Schema.String,
  },
) {}

export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()(
  "ValidationFailed",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class ProvisioningConflict extends Schema.TaggedError<ProvisioningConflict>()(
  "ProvisioningConflict",
  {
    resource: Schema.String,
    message: Schema.String,
  },
) {}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  resource: Schema.String,
  id: Schema.String,
}) {}

export class FeatureDisabled extends Schema.TaggedError<FeatureDisabled>()(
  "FeatureDisabled",
  {
    feature: Schema.String,
  },
) {}

export class ConfigInvalid extends Schema.TaggedError<ConfigInvalid>()(
  "ConfigInvalid",
  {
    provider: Schema.String,
    message: Schema.String,
  },
) {}
