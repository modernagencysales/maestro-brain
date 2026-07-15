import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import { ModelCallReceiptRow } from "../tables/modelCallReceipts";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import {
  MemberNotInWorkspace,
  Unauthorized,
  WorkspaceNotFound,
} from "../errors";

type ModelCallReceiptRowValue = Schema.Schema.Type<typeof ModelCallReceiptRow>;

export class ModelReceiptTenantMismatch extends Schema.TaggedError<ModelReceiptTenantMismatch>()(
  "ModelReceiptTenantMismatch",
  {},
) {}

export class ModelReceiptDuplicate extends Schema.TaggedError<ModelReceiptDuplicate>()(
  "ModelReceiptDuplicate",
  {},
) {}

export type ModelReceiptTenantFence = {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly lifecycleGeneration: number;
};

export const appendModelCallReceipt = (input: {
  readonly receipt: ModelCallReceiptRowValue;
  readonly tenant: ModelReceiptTenantFence;
  readonly existing: readonly ModelCallReceiptRowValue[];
}): Either.Either<
  ModelCallReceiptRowValue,
  ModelReceiptTenantMismatch | ModelReceiptDuplicate
> => {
  const { receipt, tenant } = input;

  if (
    receipt.organizationId !== tenant.organizationId ||
    receipt.workspaceId !== tenant.workspaceId ||
    receipt.lifecycleGeneration !== tenant.lifecycleGeneration
  ) {
    return Either.left(new ModelReceiptTenantMismatch());
  }

  const duplicate = input.existing.some(
    (existing) =>
      existing.organizationId === receipt.organizationId &&
      existing.workspaceId === receipt.workspaceId &&
      existing.attemptKey === receipt.attemptKey,
  );

  if (duplicate) return Either.left(new ModelReceiptDuplicate());

  return Either.right(receipt);
};

export const writeModelCallReceipt = (input: {
  readonly receipt: ModelCallReceiptRowValue;
  readonly tenant: ModelReceiptTenantFence;
}): Effect.Effect<
  ModelCallReceiptRowValue,
  ModelReceiptTenantMismatch | ModelReceiptDuplicate,
  DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    const { receipt, tenant } = input;

    if (
      receipt.organizationId !== tenant.organizationId ||
      receipt.workspaceId !== tenant.workspaceId ||
      receipt.lifecycleGeneration !== tenant.lifecycleGeneration
    ) {
      return yield* Effect.fail(new ModelReceiptTenantMismatch());
    }

    const reader = yield* DatabaseReader;
    const existing = yield* reader
      .table("modelCallReceipts")
      .index("by_workspace_attempt", (q) =>
        q
          .eq("workspaceId", tenant.workspaceId)
          .eq("attemptKey", receipt.attemptKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);

    if (
      existing !== null &&
      existing.organizationId === receipt.organizationId &&
      existing.workspaceId === receipt.workspaceId
    ) {
      return yield* Effect.fail(new ModelReceiptDuplicate());
    }

    const writer = yield* DatabaseWriter;
    yield* writer.table("modelCallReceipts").insert(receipt).pipe(Effect.orDie);

    return receipt;
  });

export const writeAuthenticatedModelCallReceipt = (input: {
  readonly workspaceId: string;
  readonly receipt: Omit<
    ModelCallReceiptRowValue,
    "organizationId" | "workspaceId"
  >;
}): Effect.Effect<
  ModelCallReceiptRowValue,
  | ModelReceiptTenantMismatch
  | ModelReceiptDuplicate
  | Unauthorized
  | WorkspaceNotFound
  | MemberNotInWorkspace,
  Auth | DatabaseReader | DatabaseWriter | Clock.Clock
> =>
  Effect.gen(function* () {
    yield* requireWorkspaceAccess(input.workspaceId as never, "editor");
    const reader = yield* DatabaseReader;
    const workspace = yield* reader
      .table("workspaces")
      .get(input.workspaceId as never)
      .pipe(Effect.orDie);
    if (workspace === null) {
      return yield* Effect.fail(new ModelReceiptTenantMismatch());
    }
    const receipt: ModelCallReceiptRowValue = {
      ...input.receipt,
      organizationId: workspace.organizationId,
      workspaceId: input.workspaceId,
    };

    return yield* writeModelCallReceipt({
      receipt,
      tenant: {
        organizationId: workspace.organizationId,
        workspaceId: input.workspaceId,
        lifecycleGeneration: receipt.lifecycleGeneration,
      },
    });
  });
