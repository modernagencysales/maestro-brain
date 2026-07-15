import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflows = {
  "brain-build-task": ["implement", "review"],
  "brain-integrate-tranche": ["integrate", "review", "repair", "record"],
  "brain-release-evidence": ["operate", "review"],
  "brain-repair-check": ["repair", "review"],
  "brain-repair-tranche": ["repair", "review", "record"],
} as const;

describe("Fabro workflow prompt contracts", () => {
  it("keeps file discovery scoped in every agent prompt", () => {
    for (const [workflow, promptNodes] of Object.entries(workflows)) {
      const path = resolve(
        import.meta.dirname,
        "../../../.fabro/workflows",
        workflow,
        "workflow.fabro",
      );
      const lines = readFileSync(path, "utf8").split("\n");
      expect(
        lines.filter((line) => line.includes('prompt="')),
        `${workflow} prompt inventory`,
      ).toHaveLength(promptNodes.length);

      for (const node of promptNodes) {
        const prompt = lines.find((line) =>
          line.trimStart().startsWith(`${node} [`),
        );
        expect(prompt, `${workflow}.${node} prompt`).toBeDefined();
        expect(prompt).toContain('prompt="');
        expect(prompt).toContain("scoped rtk rg --files <target-path>");
        expect(prompt).toContain("never use a repository-wide glob");
        expect(prompt).toContain("repos/<library>/<subpath>");
      }
    }
  });
});
