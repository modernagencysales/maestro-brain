import { hasMode, isCi } from "./src/script-mode.mts";

if (hasMode("fake")) {
  console.log("check:pr-health: ok (fake mode)");
} else if (isCi() && !process.env.GITHUB_TOKEN) {
  console.error("check:pr-health: missing GITHUB_TOKEN in CI");
  process.exitCode = 1;
} else {
  console.log("check:pr-health: ok (local no-op)");
}
