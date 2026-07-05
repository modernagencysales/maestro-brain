import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { expectDescriptorPassesAndFails } from "./src/check-test-helpers.mts";
import { descriptor } from "./check-docs-freshness.mts";

describe("check:docs-freshness", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const readRepoFile = (path: string): string =>
    readFileSync(resolve(repoRoot, path), "utf8");
  const normalizeMarkdownText = (text: string): string =>
    text.replace(/\s+/g, " ");

  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("keeps starter quickstart and maturity docs aligned with the real command flow", () => {
    const quickstart = normalizeMarkdownText(
      readRepoFile("docs/template/quickstart.md"),
    );
    const maturity = normalizeMarkdownText(
      readRepoFile("docs/template/template-maturity-model.md"),
    );
    const backlog = normalizeMarkdownText(
      readRepoFile("docs/template/porting-backlog.md"),
    );

    expect(quickstart).toContain(
      "`template:quickstart -- --write` creates `template-instance.json`",
    );
    expect(quickstart).toContain(
      "`template:doctor -- --mode fake` expects `template-instance.json`",
    );
    expect(maturity).toContain(
      "Current baseline: this repo can prove L0 through L4",
    );
    expect(maturity).toContain("L5 is client-fork-specific");
    expect(backlog).toContain(
      "Current readiness commands and the maturity model are authoritative",
    );
  });
});
