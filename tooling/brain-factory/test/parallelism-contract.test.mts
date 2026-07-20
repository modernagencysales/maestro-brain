import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  collisionFor,
  edgeFor,
  effectiveCollisionPolicy,
  loadParallelismContract,
  mandatorySameWaveGroups,
  parseParallelismContract,
  validateParallelismContract,
  verifyParallelismContractArtifacts,
  type ParallelismContract,
} from "../src/parallelism-contract.js";
import {
  MANIFEST_RELATIVE,
  PLAN_RELATIVE,
  REPO_ROOT,
  type BrainTaskManifest,
} from "../src/manifest.js";

const manifest = JSON.parse(
  readFileSync(join(REPO_ROOT, MANIFEST_RELATIVE), "utf8"),
) as BrainTaskManifest;
const contract = loadParallelismContract(REPO_ROOT);
const clone = <T,>(value: T): T => structuredClone(value);
const required = <T,>(value: T | undefined, message = "fixture drift"): T => {
  if (value === undefined) throw new Error(message);
  return value;
};

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const expectDiagnostic = (
  mutate: (draft: ParallelismContract) => void,
  pattern: RegExp,
): void => {
  const draft = clone(contract) as ParallelismContract;
  mutate(draft);
  expect(validateParallelismContract(draft, manifest)).toEqual(
    expect.arrayContaining([expect.stringMatching(pattern)]),
  );
};

describe("parallelism contract schema", () => {
  test("loads the checked-in exhaustive contract", () => {
    expect(contract.schemaVersion).toBe(
      "maestro-brain-parallelism-contract/v1",
    );
    expect(contract.manifestPlanSha256).toBe(manifest.planSha256);
    expect(contract.edges).toHaveLength(98);
    expect(
      contract.edges.filter((edge) => edge.classification === "true"),
    ).toHaveLength(54);
    expect(
      contract.edges.filter((edge) => edge.classification === "contract"),
    ).toHaveLength(44);
    expect(contract.collisions).toHaveLength(179);
    expect(validateParallelismContract(contract, manifest)).toEqual([]);
  });

  test("rejects unknown fields and malformed discriminants while parsing", () => {
    const unknownRoot = { ...clone(contract), surprise: true };
    expect(() => parseParallelismContract(unknownRoot)).toThrow(
      /unknown key surprise/,
    );

    const badEdge = clone(contract) as unknown as {
      edges: Array<Record<string, unknown>>;
    };
    badEdge.edges[0] = { ...badEdge.edges[0], classification: "soft" };
    expect(() => parseParallelismContract(badEdge)).toThrow(
      /classification must be true or contract/,
    );
  });

  test("diagnoses missing duplicate reversed unknown self and extra edges", () => {
    expectDiagnostic((draft) => {
      (draft.edges as Array<unknown>).splice(0, 1);
    }, /missing edge/);
    expectDiagnostic((draft) => {
      (draft.edges as Array<unknown>).push(clone(required(draft.edges[0])));
    }, /duplicate edge/);
    expectDiagnostic((draft) => {
      const edge = required(draft.edges[0]);
      (draft.edges as Array<unknown>)[0] = {
        ...edge,
        consumerTaskId: edge.producerTaskId,
        producerTaskId: edge.consumerTaskId,
      };
    }, /(?:reversed|extra) edge/);
    expectDiagnostic((draft) => {
      (draft.edges as Array<unknown>)[0] = {
        ...draft.edges[0],
        producerTaskId: "S99-T99",
      };
    }, /unknown producer task S99-T99/);
    expectDiagnostic((draft) => {
      (draft.edges as Array<unknown>)[0] = {
        ...required(draft.edges[0]),
        producerTaskId: required(draft.edges[0]).consumerTaskId,
      };
    }, /self-edge/);
    expectDiagnostic((draft) => {
      (draft.edges as Array<unknown>).push({
        consumerTaskId: "S00-T01",
        producerTaskId: "S14-T01",
        classification: "true",
      });
    }, /extra edge/);
  });

  test("requires exact packet identity for every contract edge", () => {
    const index = contract.edges.findIndex(
      (edge) => edge.classification === "contract",
    );
    expectDiagnostic((draft) => {
      (draft.edges as Array<unknown>)[index] = {
        ...draft.edges[index],
        artifact: undefined,
      };
    }, /contract edge requires exactly one task-packet artifact/);
    expectDiagnostic((draft) => {
      const edge = required(draft.edges[index]);
      if (edge.classification !== "contract") throw new Error("fixture drift");
      (draft.edges as Array<unknown>)[index] = {
        ...edge,
        artifact: { ...edge.artifact, path: "elsewhere.md" },
      };
    }, /artifact path/);
    expectDiagnostic((draft) => {
      const edge = required(draft.edges[index]);
      if (edge.classification !== "contract") throw new Error("fixture drift");
      (draft.edges as Array<unknown>)[index] = {
        ...edge,
        artifact: { ...edge.artifact, sha256: "f".repeat(64) },
      };
    }, /artifact hash .* taskBlockHash/);
  });

  test("diagnoses exact collision-pair and intersection-path drift", () => {
    expectDiagnostic((draft) => {
      (draft.collisions as Array<unknown>).splice(0, 1);
    }, /missing collision/);
    expectDiagnostic((draft) => {
      (draft.collisions as Array<unknown>).push(
        clone(required(draft.collisions[0])),
      );
    }, /duplicate collision/);
    expectDiagnostic((draft) => {
      const collision = required(draft.collisions[0]);
      (draft.collisions as Array<unknown>)[0] = {
        ...collision,
        paths: [...collision.paths, "not/shared.ts"],
      };
    }, /collision paths .* do not match manifest intersection/);
  });

  test("keeps migrations serialized until the Task 6 registry exists", () => {
    const migration = contract.collisions.find((collision) =>
      collision.paths.includes(
        "packages/convex/confect/internal/migrations.ts",
      ),
    );
    expect(migration).toBeDefined();
    const migrationCollision = required(migration);
    expect(effectiveCollisionPolicy(migrationCollision, false)).toBe(
      "serialize",
    );
    expect(effectiveCollisionPolicy(migrationCollision, true)).toBe(
      "regenerate",
    );
  });

  test("orders every remaining migration consumer after the S05 producer", () => {
    for (const taskId of [
      "S02-T03",
      "S06-T01",
      "S07-T01",
      "S08-T03",
      "S08-T04",
      "S09-T02",
      "S10-T01",
    ]) {
      expect(edgeFor(contract, taskId, "S05-T01"), taskId).toEqual({
        consumerTaskId: taskId,
        producerTaskId: "S05-T01",
        classification: "true",
      });
    }
    expect(edgeFor(contract, "S11-T01", "S05-T01")).toBeUndefined();
  });

  test("orders S10 identity lifecycle integration after its true producers", () => {
    for (const producerTaskId of ["S01-T02", "S04-T02", "S05-T01"]) {
      expect(edgeFor(contract, "S10-T01", producerTaskId)).toEqual({
        consumerTaskId: "S10-T01",
        producerTaskId,
        classification: "true",
      });
    }
    expect(collisionFor(contract, "S04-T02", "S10-T01")).toEqual({
      leftTaskId: "S04-T02",
      rightTaskId: "S10-T01",
      paths: [
        "packages/convex/confect/integrations/slackDirectory.impl.ts",
        "packages/convex/test/slack-directory.test.ts",
      ],
      policy: "dependency_order",
    });
  });

  test("requires same-wave collisions to declare mandatory co-integration", () => {
    const index = contract.collisions.findIndex(
      (collision) => collision.policy === "same_wave_fail_closed",
    );
    expectDiagnostic((draft) => {
      (draft.collisions as Array<unknown>)[index] = {
        ...required(draft.collisions[index]),
        mandatorySameWave: undefined,
      };
    }, /same_wave_fail_closed requires mandatorySameWave=true/);
  });

  test("keeps S04 sole owner of the logging checker", () => {
    expect(collisionFor(contract, "S04-T03", "S13-T03")).toBeUndefined();
    expect(
      contract.collisions.filter((collision) =>
        collision.paths.includes("tooling/quality/check-logging-boundary.mts"),
      ),
    ).toEqual([]);
  });

  test("rejects cycles in the true-edge graph with a concrete path", () => {
    expectDiagnostic((draft) => {
      (draft.edges as Array<unknown>).push({
        consumerTaskId: "S00-T02",
        producerTaskId: "S14-T01",
        classification: "true",
      });
      const release = draft.edges.find(
        (edge) =>
          edge.consumerTaskId === "S14-T01" &&
          edge.producerTaskId === "S10-T04",
      );
      if (!release) throw new Error("fixture drift");
      (draft.edges as Array<unknown>).push({
        consumerTaskId: "S10-T04",
        producerTaskId: "S00-T02",
        classification: "true",
      });
    }, /true-edge cycle: .*S00-T02.*S10-T04.*S14-T01/);
  });
});

describe("parallelism contract queries", () => {
  test("looks up classified edges and canonical collision pairs", () => {
    expect(edgeFor(contract, "S04-T01", "S00-T03")?.classification).toBe(
      "contract",
    );
    expect(edgeFor(contract, "S04-T02", "S04-T01")?.classification).toBe(
      "true",
    );
    expect(collisionFor(contract, "S11-T02", "S02-T02")?.policy).toBe(
      "serialize",
    );
    expect(collisionFor(contract, "S02-T02", "S11-T02")?.policy).toBe(
      "serialize",
    );
    expect(collisionFor(contract, "S02-T04", "S03-T03")?.paths).toContain(
      "packages/convex/confect/editor/documentTargets.ts",
    );
  });

  test("returns deterministic connected mandatory same-wave groups", () => {
    const groups = mandatorySameWaveGroups(contract);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group).toEqual([...group].sort());
      expect(new Set(group).size).toBe(group.length);
    }
    expect(groups).toEqual(
      [...groups].sort((a, b) => required(a[0]).localeCompare(required(b[0]))),
    );
  });
});

describe("contract artifact verification", () => {
  test("verifies every frozen task packet against current plan bytes", () => {
    expect(
      verifyParallelismContractArtifacts(contract, manifest, REPO_ROOT),
    ).toEqual([]);
  });

  test("reports producer and artifact identity when packet bytes drift", () => {
    const root = mkdtempSync(join(tmpdir(), "parallelism-contract-"));
    const sourcePlan = readFileSync(join(REPO_ROOT, PLAN_RELATIVE), "utf8");
    const target = join(root, PLAN_RELATIVE);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      sourcePlan.replace("### S00-T03", "### S00-T03 drift"),
    );
    const errors = verifyParallelismContractArtifacts(contract, manifest, root);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/S00-T03.*task-packet.*hash drift/),
      ]),
    );
  });

  test("the checked-in manifest plan hash remains exact", () => {
    expect(digest(readFileSync(join(REPO_ROOT, PLAN_RELATIVE), "utf8"))).toBe(
      manifest.planSha256,
    );
  });
});
