import { describe, expect, it } from "vitest";
import {
  CI_PROOF_SCHEMA_VERSION,
  isCompatibleProofHead,
  proofChangedFilesMatch,
  validateProofContract,
} from "../src/proof.js";

describe("Fabro checkpoint proof heads", () => {
  it("accepts the exact proved head", () => {
    expect(
      isCompatibleProofHead({
        ancestorExit: 1,
        currentHead: "same",
        proofHead: "same",
        treeDiffExit: 1,
      }),
    ).toBe(true);
  });

  it("accepts a same-tree checkpoint descendant", () => {
    expect(
      isCompatibleProofHead({
        ancestorExit: 0,
        currentHead: "checkpoint",
        proofHead: "task",
        treeDiffExit: 0,
      }),
    ).toBe(true);
  });

  it("rejects divergent code after proof", () => {
    expect(
      isCompatibleProofHead({
        ancestorExit: 0,
        currentHead: "changed",
        proofHead: "task",
        treeDiffExit: 1,
      }),
    ).toBe(false);
  });

  it("requires the proof to enumerate every changed file exactly once", () => {
    expect(proofChangedFilesMatch(["b.ts", "a.ts"], ["a.ts", "b.ts"])).toBe(
      true,
    );
    expect(proofChangedFilesMatch(["a.ts"], ["a.ts", "release.sh"])).toBe(
      false,
    );
    expect(proofChangedFilesMatch(["a.ts", "a.ts"], ["a.ts"])).toBe(false);
  });

  it("requires versioned proof provenance bound to the current task block", () => {
    const identity = {
      taskId: "S09-T01",
      taskBlockHash: "task",
    };
    const proof = {
      schemaVersion: CI_PROOF_SCHEMA_VERSION,
      taskId: "S09-T01",
      planSha256: "plan",
      taskBlockHash: "task",
    };
    expect(validateProofContract(proof, identity)).toBe("plan");
    expect(
      validateProofContract({ ...proof, planSha256: "prior-plan" }, identity),
    ).toBe("prior-plan");

    for (const [field, value, message] of [
      ["schemaVersion", "legacy", "unexpected CI proof schema"],
      ["planSha256", "", "proof plan provenance missing"],
      ["taskBlockHash", "stale", "proof task block hash mismatch"],
      ["taskId", "S09-T02", "proof task mismatch"],
    ] as const) {
      expect(() =>
        validateProofContract({ ...proof, [field]: value }, identity),
      ).toThrow(message);
    }
  });
});
