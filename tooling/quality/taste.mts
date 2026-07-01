import { hasMode, isCi } from "./src/script-mode.mts";

if (hasMode("fake")) {
  console.log("taste: verdict=pass reason=fake-mode");
} else if (isCi() && !process.env.OPENAI_API_KEY) {
  console.error("taste: missing OPENAI_API_KEY in CI");
  process.exitCode = 1;
} else {
  console.log("taste: local no-op; pass --mode fake for test verdicts");
}
