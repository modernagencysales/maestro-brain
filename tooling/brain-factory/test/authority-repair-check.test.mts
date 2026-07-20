import { describe, expect, it } from "vitest";

import {
  validateAuthorityRepairRewrite,
  validateOwnershipRehomeRewrite,
} from "../src/authority-repair-check.js";

describe("authority repair rewrite", () => {
  const transition = {
    schemaVersion: "maestro-brain-authority-repair-transition/v1" as const,
    mode: "path-rehome" as const,
    fromPlanSha256: "a".repeat(64),
    fromTaskBlockHash: "b".repeat(64),
    sourceRunId: "01KXZP38CAC2GYAF2YA7NRTBQK",
    sourceBaseSha: "1".repeat(40),
    sourceHeadSha: "2".repeat(40),
    sourceTreeSha: "3".repeat(40),
    requiredIntegratedTaskIds: ["S01-T01"],
    immutableFindings: [
      {
        kind: "git-blob" as const,
        objectSha: "4".repeat(40),
        contentSha256: "5".repeat(64),
      },
    ],
    supersededPaths: [
      {
        path: "obsolete.ts",
        replacementPath: "replacement.json",
        disposition: "replaced-by-current-owned-artifact" as const,
      },
    ],
  };

  it("requires the obsolete diff to disappear and its replacement to exist", () => {
    expect(() =>
      validateAuthorityRepairRewrite({
        changedFiles: ["owned.ts", "replacement.json"],
        fileLocks: ["owned.ts", "replacement.json"],
        transition,
      }),
    ).not.toThrow();
    expect(() =>
      validateAuthorityRepairRewrite({
        changedFiles: ["obsolete.ts", "replacement.json"],
        fileLocks: ["owned.ts", "replacement.json"],
        transition,
      }),
    ).toThrow("superseded path remains");
    expect(() =>
      validateAuthorityRepairRewrite({
        changedFiles: ["owned.ts"],
        fileLocks: ["owned.ts", "replacement.json"],
        transition,
      }),
    ).toThrow("replacement path is absent");
    expect(() =>
      validateAuthorityRepairRewrite({
        changedFiles: ["owned.ts", "replacement.json", "unowned.ts"],
        fileLocks: ["owned.ts", "replacement.json"],
        transition,
      }),
    ).toThrow("not declared in current manifest fileLocks");
  });

  it("keeps ownership-rehome validation distinct and exact", () => {
    const rehome = {
      ...transition,
      schemaVersion: "maestro-brain-ownership-rehome-transition/v1" as const,
      classification: "ownership-rehome" as const,
      immutableFinding: {
        kind: "git-blob" as const,
        ref: "refs/maestro-brain/evidence/s03-t03-ownership-rehome",
        objectSha: "4".repeat(40),
        contentSha256: "5".repeat(64),
      },
      immutableFindings: undefined,
      mode: undefined,
    };
    expect(() =>
      validateOwnershipRehomeRewrite({
        changedFiles: ["owned.ts", "replacement.json"],
        fileLocks: ["owned.ts", "replacement.json"],
        transition: rehome,
      }),
    ).not.toThrow();
    expect(() =>
      validateOwnershipRehomeRewrite({
        changedFiles: ["obsolete.ts", "replacement.json"],
        fileLocks: ["owned.ts", "replacement.json"],
        transition: rehome,
      }),
    ).toThrow("ownership-rehome superseded path remains");
    expect(() =>
      validateOwnershipRehomeRewrite({
        changedFiles: ["owned.ts"],
        fileLocks: ["owned.ts", "replacement.json"],
        transition: rehome,
      }),
    ).toThrow("ownership-rehome replacement path is absent");
  });
});
