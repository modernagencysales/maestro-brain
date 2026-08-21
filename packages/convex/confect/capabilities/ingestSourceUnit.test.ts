import { describe, expect, it } from "vitest";

import {
  planSourceUnitIngestion,
  requireSourceIngestionCaller,
} from "./ingestSourceUnit.domain";
import ingestSourceUnitGroup, { manifest } from "./ingestSourceUnit.spec";

describe("ingestSourceUnit internal capability", () => {
  it("is idempotent and has no external surface", () => {
    expect(ingestSourceUnitGroup.functions.ingestSourceUnit).toMatchObject({
      functionVisibility: "internal",
      name: "ingestSourceUnit",
    });
    expect(manifest).toEqual([
      expect.objectContaining({
        operationId: "capabilities.ingestSourceUnit.ingestSourceUnit",
        kind: "mutation",
        surfaces: ["workflow", "internal"],
        idempotent: true,
      }),
    ]);
  });

  it("plans inserts, duplicates, updates, and tombstones", () => {
    const v1 = {
      kind: "provider_timestamp" as const,
      timestamp: "2026-08-05T14:00:00.000Z",
      source: "updated_at",
    };
    const v2 = {
      ...v1,
      timestamp: "2026-08-05T15:00:00.000Z",
    };
    const v3 = {
      ...v1,
      timestamp: "2026-08-05T16:00:00.000Z",
    };
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: null,
        currentRevisionOrder: null,
        incomingUnitRevisionKey: "surev_1",
        incomingRevisionOrder: v1,
        incomingDeleted: false,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "inserted", replaceCurrent: false });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_1",
        currentRevisionOrder: v1,
        incomingUnitRevisionKey: "surev_1",
        incomingRevisionOrder: v1,
        incomingDeleted: false,
        revisionAlreadyExists: true,
      }),
    ).toEqual({ outcome: "duplicate" });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_1",
        currentRevisionOrder: v1,
        incomingUnitRevisionKey: "surev_2",
        incomingRevisionOrder: v2,
        incomingDeleted: false,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "inserted", replaceCurrent: true });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_2",
        currentRevisionOrder: v2,
        incomingUnitRevisionKey: "surev_3",
        incomingRevisionOrder: v3,
        incomingDeleted: true,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "tombstone", replaceCurrent: true });
  });

  it("retains stale observations and rejects ambiguous ordering", () => {
    const current = {
      kind: "provider_timestamp" as const,
      timestamp: "2026-08-05T15:00:00.000Z",
      source: "updated_at",
    };
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_3",
        currentRevisionOrder: current,
        incomingUnitRevisionKey: "surev_2",
        incomingRevisionOrder: {
          ...current,
          timestamp: "2026-08-05T14:00:00.000Z",
        },
        incomingDeleted: false,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "stale", replaceCurrent: false });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_3",
        currentRevisionOrder: current,
        incomingUnitRevisionKey: "surev_conflict",
        incomingRevisionOrder: current,
        incomingDeleted: false,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "conflict", reason: "equal_order" });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_3",
        currentRevisionOrder: current,
        incomingUnitRevisionKey: "surev_epoch",
        incomingRevisionOrder: {
          kind: "reconciliation_epoch",
          epoch: 4,
        },
        incomingDeleted: false,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "conflict", reason: "incompatible_order" });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_legacy",
        currentRevisionOrder: null,
        incomingUnitRevisionKey: "surev_new",
        incomingRevisionOrder: current,
        incomingDeleted: false,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "conflict", reason: "missing_current_order" });
  });

  it("accepts only workflow and internal system callers", () => {
    expect(
      requireSourceIngestionCaller({
        kind: "system",
        name: "transcript-sync",
        surface: "internal",
      }),
    ).toBe(true);
    expect(
      requireSourceIngestionCaller({
        kind: "user",
        name: "not-system",
        surface: "web",
      }),
    ).toBe(false);
  });
});
