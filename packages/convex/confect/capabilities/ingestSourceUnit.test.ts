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
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: null,
        incomingUnitRevisionKey: "surev_1",
        incomingDeleted: false,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "inserted", replaceCurrent: false });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_1",
        incomingUnitRevisionKey: "surev_1",
        incomingDeleted: false,
        revisionAlreadyExists: true,
      }),
    ).toEqual({ outcome: "duplicate" });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_1",
        incomingUnitRevisionKey: "surev_2",
        incomingDeleted: false,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "inserted", replaceCurrent: true });
    expect(
      planSourceUnitIngestion({
        currentUnitRevisionKey: "surev_2",
        incomingUnitRevisionKey: "surev_3",
        incomingDeleted: true,
        revisionAlreadyExists: false,
      }),
    ).toEqual({ outcome: "tombstone", replaceCurrent: true });
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
