import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type SlackCaptureReceipt = Readonly<{
  _id: Id<"providerEventReceipts">;
  organizationKey: string;
  channelKey: string;
  sourceKey: string | null;
  connectionKey: string;
  connectionGeneration: number;
}>;

export const assertSlackCaptureRevision: (
  receipt: SlackCaptureReceipt,
  revision: Doc<"sourceRevisions"> | null,
) => asserts revision is Doc<"sourceRevisions"> = (receipt, revision) => {
  if (revision === null)
    throw new Error("SlackCaptureRevisionAuthorityMissing");
  if (revision.sourceKey !== receipt.sourceKey)
    throw new Error("SlackCaptureRevisionAuthorityMissing");
  if (revision.connectionKey !== receipt.connectionKey)
    throw new Error("SlackCaptureRevisionAuthorityMissing");
  if (revision.connectionGeneration !== receipt.connectionGeneration)
    throw new Error("SlackCaptureRevisionAuthorityMissing");
};

export const assertProviderTargetResolutionAuthority = (
  existing: Doc<"providerTargetResolutionIntents"> | undefined,
  authorityDigest: string,
) => {
  if (existing === undefined) return;
  if (existing.authorityKind !== "live_capture")
    throw new Error("SlackProviderTargetResolutionAuthorityConflict");
  if (existing.authorityDigest !== authorityDigest)
    throw new Error("SlackProviderTargetResolutionAuthorityConflict");
};

export const ensureSlackPublicationTargetIntent = async (input: {
  readonly ctx: MutationCtx;
  readonly receipt: SlackCaptureReceipt;
  readonly sourceRevisionKey: string;
  readonly providerTargetResolutionIntentId: Id<"providerTargetResolutionIntents">;
  readonly now: number;
}) => {
  const existing = await input.ctx.db
    .query("slackPublicationTargetIntents")
    .withIndex("by_receipt_id", (query) =>
      query.eq("receiptId", input.receipt._id),
    )
    .unique();
  if (existing === null) {
    await input.ctx.db.insert("slackPublicationTargetIntents", {
      schemaVersion: 1,
      receiptId: input.receipt._id,
      organizationKey: input.receipt.organizationKey,
      channelKey: input.receipt.channelKey,
      sourceRevisionKey: input.sourceRevisionKey,
      providerTargetResolutionIntentId: input.providerTargetResolutionIntentId,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: input.now,
      lastErrorTag: null,
      resolutionGeneration: 1,
      targetCount: 0,
      completedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return;
  }
  if (existing.providerTargetResolutionIntentId === undefined) {
    await input.ctx.db.patch(existing._id, {
      providerTargetResolutionIntentId: input.providerTargetResolutionIntentId,
      updatedAt: input.now,
    });
    return;
  }
  if (
    existing.providerTargetResolutionIntentId !==
    input.providerTargetResolutionIntentId
  )
    throw new Error("SlackProviderTargetResolutionLinkageConflict");
};
