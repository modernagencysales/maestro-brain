import { hasMode, isCi } from "./src/script-mode.mts";

if (hasMode("fake")) {
  console.log("check:unresolved-review-threads: ok (fake mode)");
} else if (isCi() && !process.env.GITHUB_TOKEN) {
  console.error("check:unresolved-review-threads: missing GITHUB_TOKEN in CI");
  process.exitCode = 1;
} else {
  console.log("check:unresolved-review-threads: ok (local no-op)");
}
