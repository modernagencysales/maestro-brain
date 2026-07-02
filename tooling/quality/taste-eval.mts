/**
 * taste-eval — thin CLI entrypoint for taste judge calibration
 * (`pnpm taste:eval`). Runs the calibration fixtures under
 * tooling/quality/__fixtures__/taste and asserts the judge passes good code
 * and blocks bad code. Delegates to taste-review.mts with --eval forced.
 */
import { isDirectRun } from "./src/direct-run.mts";
import { runTasteCli } from "./taste-review.mts";

if (isDirectRun(import.meta.url)) {
  await runTasteCli([...process.argv, "--eval"]);
}
