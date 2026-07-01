import { hasMode, isCi } from "./src/script-mode.mts";

if (hasMode("fake")) {
  console.log("contract-review: verdict=pass reason=fake-mode");
} else if (isCi() && !process.env.OPENAI_API_KEY) {
  console.error("contract-review: missing OPENAI_API_KEY in CI");
  process.exitCode = 1;
} else {
  console.log(
    "contract-review: local no-op; pass --mode fake for test verdicts",
  );
}
