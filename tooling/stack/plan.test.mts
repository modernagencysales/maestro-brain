import { expect, test } from "vitest";
import { MAX_DEPTH, type StackPlan, validatePlan } from "./plan.mts";
import { contractRisksForLayers } from "./contract-risk-registry.mts";

const slice = (over: Partial<StackPlan["slices"][number]> = {}) => ({
  id: 1,
  branch: "feat/x-1-schema",
  intention: "add the x table",
  layers: ["schema"],
  contractRiskIds: contractRisksForLayers(["schema"]),
  taskRefs: ["t1"],
  rationale: "standalone: table + validator",
  estLines: 40,
  ...over,
});

const plan = (over: Partial<StackPlan> = {}): StackPlan => ({
  feature: "x",
  slices: [slice()],
  allTaskRefs: ["t1"],
  ...over,
});

test("a sound single-slice plan passes", () => {
  expect(validatePlan(plan())).toEqual([]);
});

test("rejects a slice missing layer-required contract risks", () => {
  const errs = validatePlan(
    plan({ slices: [slice({ contractRiskIds: ["policy-data-hardcoded"] })] }),
  );
  expect(
    errs.some((e) => e.includes("missing layer-required contractRiskIds")),
  ).toBe(true);
});

test("rejects an oversized estimate", () => {
  const errs = validatePlan(plan({ slices: [slice({ estLines: 301 })] }));
  expect(errs.some((e) => e.includes("estLines"))).toBe(true);
});

test("rejects out-of-order layers (capability below its schema)", () => {
  const errs = validatePlan(
    plan({
      slices: [
        slice({ id: 1, layers: ["capabilities"] }),
        slice({
          id: 2,
          layers: ["schema"],
          branch: "feat/x-2",
          taskRefs: ["t2"],
        }),
      ],
      allTaskRefs: ["t1", "t2"],
    }),
  );
  expect(errs.some((e) => e.includes("dependency order"))).toBe(true);
});

test("rejects an incomplete plan (a task not shipped)", () => {
  const errs = validatePlan(plan({ allTaskRefs: ["t1", "t2"] }));
  expect(errs.some((e) => e.includes("does not cover"))).toBe(true);
});

test("rejects a stack deeper than MAX_DEPTH", () => {
  const slices = Array.from({ length: MAX_DEPTH + 1 }, (_, i) =>
    slice({ id: i + 1, branch: `feat/x-${i + 1}`, taskRefs: [`t${i + 1}`] }),
  );
  const errs = validatePlan(
    plan({ slices, allTaskRefs: slices.map((s) => s.taskRefs[0]) }),
  );
  expect(errs.some((e) => e.includes("depth"))).toBe(true);
});
