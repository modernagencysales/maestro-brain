import { spawnSync } from "node:child_process";
import { hasMode, isCi } from "./src/script-mode.mts";

if (hasMode("fake")) {
  console.log("check:qlty: ok (fake mode)");
} else {
  const available = spawnSync("qlty", ["--version"], { encoding: "utf8" });
  if (available.status === 0) {
    const result = spawnSync(
      "qlty",
      ["check", "--all", "--no-fix", "--fail-level=note"],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      process.stdout.write(result.stdout);
    } else if (isCi()) {
      process.stderr.write(result.stderr);
      process.exitCode = result.status ?? 1;
    } else {
      console.log(
        "check:qlty: qlty available but not initialized; run qlty init to enable local quality checks",
      );
    }
  } else if (isCi()) {
    console.error("check:qlty: qlty binary missing in CI");
    process.exitCode = 1;
  } else {
    console.log(
      "check:qlty: qlty not installed; skipping local optional check",
    );
  }
}
