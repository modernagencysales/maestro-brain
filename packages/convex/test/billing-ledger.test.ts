import { describe, expect, it } from "vitest";
import billingPlans from "../confect/tables/billingPlans";
import creditLedger from "../confect/tables/creditLedger";
import usageEvents from "../confect/tables/usageEvents";

describe("billing ledger Confect tables", () => {
  it("declares billing plan, credit ledger, and usage event indexes", () => {
    expect(billingPlans.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_workspace_status: ["workspaceId", "status"],
    });
    expect(creditLedger.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_idempotency: ["idempotencyKey"],
      by_workspace_created: ["workspaceId", "createdAt"],
    });
    expect(usageEvents.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_idempotency: ["idempotencyKey"],
      by_provider: ["provider"],
    });
  });
});
