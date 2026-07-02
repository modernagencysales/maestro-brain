/**
 * taste — thin CLI entrypoint for the taste AI gate (`pnpm taste`).
 * All review logic lives in taste-review.mts; this file only forwards argv so
 * the root package.json script name stays stable.
 */
import { isDirectRun } from "./src/direct-run.mts";
import { runTasteCli } from "./taste-review.mts";

if (isDirectRun(import.meta.url)) await runTasteCli(process.argv);
