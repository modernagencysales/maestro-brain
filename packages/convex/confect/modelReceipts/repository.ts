import * as Schema from "effect/Schema";
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
