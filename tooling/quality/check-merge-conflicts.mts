import { hasMode, isCi } from "./src/script-mode.mts";

if (hasMode("fake")) {
  console.log("check:merge-conflicts: ok (fake mode)");
} else if (isCi() && !process.env.GITHUB_TOKEN) {
  console.error("check:merge-conflicts: missing GITHUB_TOKEN in CI");
  process.exitCode = 1;
} else {
  console.log("check:merge-conflicts: ok (local no-op)");
}
