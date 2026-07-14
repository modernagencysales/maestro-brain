import { describe, expect, it } from "vitest";
import { commandsForProfiles, lintCommandForFiles } from "../src/gates.js";

describe("brain lane gate profiles", () => {
  it("deduplicates package gates", () => {
    const commands = commandsForProfiles(["convex", "convex"]);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({
      program: "pnpm",
      args: ["--dir", "packages/convex", "typecheck"],
    });
  });

  it("routes tests through the focused host slot", () => {
    const commands = commandsForProfiles(["web"]);
    expect(commands[1]).toEqual({
      program: "host-test-slot",
      args: ["--class", "focused", "pnpm", "--dir", "apps/web", "test"],
    });
  });

  it("does not invent local gates for external receipts", () => {
    expect(commandsForProfiles(["external"])).toEqual([]);
  });

  it("lints changed source without passing docs or env files", () => {
    expect(
      lintCommandForFiles([
        "apps/web/src/example.tsx",
        "apps/web/src/example.tsx",
        "docs/example.md",
        ".env.example",
      ]),
    ).toEqual({
      program: "pnpm",
      args: ["exec", "eslint", "apps/web/src/example.tsx"],
    });
    expect(lintCommandForFiles(["docs/example.md"])).toBeUndefined();
  });
});
