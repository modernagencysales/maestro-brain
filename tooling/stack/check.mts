/**
 * stack:check — validate a StackPlan JSON deterministically (plan.mts). Run by
 * the agent AND always by stack:submit before any branch work, so the happy
 * path cannot skip the depth/order/completeness guardrails (spec §2.4).
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { type StackPlan, validatePlan } from "./plan.mts";

export function checkPlanFile(url: URL): string[] {
  const plan = JSON.parse(readFileSync(url, "utf8")) as StackPlan;
  return validatePlan(plan);
}

// CLI: `tsx tooling/stack/check.mts <plan.json>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: stack:check <plan.json>");
    process.exit(2);
  }
  const errors = checkPlanFile(new URL(file, `file://${process.cwd()}/`));
  if (errors.length > 0) {
    console.error(
      `✗ stack plan invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("✓ stack plan valid");
}
