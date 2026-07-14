import { describe, expect, it } from "vitest";
import { commandsForProfiles } from "../src/gates.js";

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
});
