import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { ModelCallReceiptRow } from "../tables/modelCallReceipts";

type ModelCallReceiptRowValue = Schema.Schema.Type<typeof ModelCallReceiptRow>;

export class ModelReceiptTenantMismatch extends Error {
  constructor(message = "Model receipt tenant fence mismatch.") {
    super(message);
    this.name = "ModelReceiptTenantMismatch";
  }
}

export class ModelReceiptDuplicate extends Error {
  constructor(message = "Duplicate model receipt attempt.") {
    super(message);
    this.name = "ModelReceiptDuplicate";
  }
}

export type ModelReceiptTenantFence = {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly lifecycleGeneration: number;
};

export const appendModelCallReceipt = (input: {
  readonly receipt: ModelCallReceiptRowValue;
  readonly tenant: ModelReceiptTenantFence;
  readonly existing: readonly ModelCallReceiptRowValue[];
}): ModelCallReceiptRowValue => {
  const { receipt, tenant } = input;

  if (
    receipt.organizationId !== tenant.organizationId ||
    receipt.workspaceId !== tenant.workspaceId ||
    receipt.lifecycleGeneration !== tenant.lifecycleGeneration
  ) {
    throw new ModelReceiptTenantMismatch();
  }

  const duplicate = input.existing.some(
    (existing) =>
      existing.organizationId === receipt.organizationId &&
      existing.workspaceId === receipt.workspaceId &&
      existing.attemptKey === receipt.attemptKey,
  );

  if (duplicate) throw new ModelReceiptDuplicate();

  return receipt;
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
      .index("by_attempt", (q) => q.eq("attemptKey", receipt.attemptKey))
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);

    if (
      existing !== null &&
      existing.organizationId === receipt.organizationId
    ) {
      return yield* Effect.fail(new ModelReceiptDuplicate());
    }

    const writer = yield* DatabaseWriter;
    yield* writer.table("modelCallReceipts").insert(receipt).pipe(Effect.orDie);

    return receipt;
  });
