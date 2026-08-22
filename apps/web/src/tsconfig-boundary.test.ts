import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tsconfigPath = fileURLToPath(
  new URL("../tsconfig.json", import.meta.url),
);

describe("web TypeScript boundary", () => {
  it("keeps unconfigured Storybook examples outside the production program", () => {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
      exclude?: string[];
    };

    expect(tsconfig.exclude).toEqual(
      expect.arrayContaining([
        "src/**/*.stories.ts",
        "src/**/*.stories.tsx",
        "src/**/stories.tsx",
      ]),
    );
  });
});
