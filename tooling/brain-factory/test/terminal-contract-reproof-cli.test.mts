import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("terminal contract-reproof CLI", () => {
  it("wires an exclusive resume mode that retains the request", () => {
    const resume = readFileSync(
      fileURLToPath(new URL("../src/resume.mts", import.meta.url)),
      "utf8",
    );
    expect(resume).toContain("--terminal-contract-reproof");
    expect(resume).toContain("launchTerminalContractReproofResume({");
  });
});
