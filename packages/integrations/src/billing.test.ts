import { describe, expect, it } from "vitest";
import {
  addCredits,
  deductCredits,
  duplicateUsageEvent,
  computeCreditBalance,
  createFakeBillingReceipt,
  LowBalanceError,
  preflightSeatCount,
  recordUsageEvent,
} from "./billing";

describe("billing and usage ledger minimum", () => {
  it("adds and deducts credits through append-only ledger entries", () => {
    const credit = addCredits({
      workspaceSlug: "acme-demo",
      credits: 100,
      reason: "manual_adjustment",
      idempotencyKey: "credit-001",
      createdAt: 1_000,
    });
    const debit = deductCredits({
      workspaceSlug: "acme-demo",
      existingEntries: [credit],
      credits: 35,
      reason: "llm_usage",
      idempotencyKey: "debit-001",
      createdAt: 2_000,
    });

    expect(debit).toMatchObject({
      type: "debit",
      credits: 35,
      balanceAfter: 65,
    });
    if (debit instanceof LowBalanceError) {
      throw new Error("Expected debit ledger entry");
    }
    expect(computeCreditBalance([credit, debit])).toBe(65);
  });

  it("denies deductions that would create a negative balance", () => {
    const result = deductCredits({
      workspaceSlug: "acme-demo",
      existingEntries: [],
      credits: 1,
      reason: "llm_usage",
      idempotencyKey: "debit-001",
      createdAt: 2_000,
    });

    expect(result).toBeInstanceOf(LowBalanceError);
    expect(result).toMatchObject({
      _tag: "LowBalanceError",
      workspaceSlug: "acme-demo",
      availableCredits: 0,
      requestedCredits: 1,
    });
  });

  it("keeps usage events idempotent by idempotency key", () => {
    const first = recordUsageEvent({
      existingEvents: [],
      workspaceSlug: "acme-demo",
      idempotencyKey: "usage-001",
      provider: "openrouter",
      units: 10,
      costCredits: 2,
      createdAt: 1_000,
    });
    const second = recordUsageEvent({
      existingEvents: [first],
      workspaceSlug: "acme-demo",
      idempotencyKey: "usage-001",
      provider: "openrouter",
      units: 10,
      costCredits: 2,
      createdAt: 2_000,
    });

    expect(second).toBe(first);
    expect(duplicateUsageEvent([first], "usage-001")).toBe(true);
  });

  it("emits low-balance warnings and seat-count preflight failures", () => {
    const entry = addCredits({
      workspaceSlug: "acme-demo",
      credits: 5,
      reason: "manual_adjustment",
      idempotencyKey: "credit-001",
      createdAt: 1_000,
    });

    expect(entry.lowBalance).toEqual({
      workspaceSlug: "acme-demo",
      balanceCredits: 5,
      thresholdCredits: 10,
    });
    expect(
      preflightSeatCount({
        currentSeats: 4,
        requestedSeats: 6,
        seatLimit: 5,
      }),
    ).toMatchObject({
      _tag: "SeatLimitExceededError",
      requestedSeats: 6,
      seatLimit: 5,
    });
  });

  it("creates fake billing receipts without leaking customer or provider metadata", () => {
    const receipt = createFakeBillingReceipt({
      workspaceSlug: "acme-demo",
      operation: "checkout.created",
      idempotencyKey: "checkout-001",
      credits: 100,
      customerMetadata: {
        email: "buyer@example.com",
        companyDomain: "example.com",
      },
      providerMetadata: {
        customerId: "cust_secret",
        checkoutSessionId: "checkout_secret",
      },
      createdAt: 1_000,
    });

    expect(receipt).toEqual({
      receiptId: "billing_acme-demo_checkout-001",
      workspaceSlug: "acme-demo",
      mode: "fake",
      operation: "checkout.created",
      idempotencyKey: "checkout-001",
      credits: 100,
      customerMetadata: "[redacted]",
      providerMetadata: "[redacted]",
      createdAt: 1_000,
    });
    expect(JSON.stringify(receipt)).not.toContain("buyer@example.com");
    expect(JSON.stringify(receipt)).not.toContain("cust_secret");
  });
});
