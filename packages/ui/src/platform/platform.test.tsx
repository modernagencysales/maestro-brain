import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLocalizedPlatformLabels,
  filterCommandPaletteItems,
} from "./command-palette";

const read = (path: string): string => readFileSync(path, "utf8");

describe("frontend platform primitives", () => {
  it("filters command palette route and action commands without backend SDK imports", () => {
    const commands = [
      {
        id: "route.workflows",
        label: "Workflows",
        keywords: ["workflow", "run", "agent"],
        kind: "route" as const,
        href: "/workflows",
      },
      {
        id: "action.invite",
        label: "Invite teammate",
        keywords: ["team", "member", "seat"],
        kind: "action" as const,
      },
    ];

    expect(filterCommandPaletteItems(commands, "agent")).toEqual([commands[0]]);
    expect(filterCommandPaletteItems(commands, "seat")).toEqual([commands[1]]);

    const source = read("src/platform/command-palette.tsx");

    expect(source).toContain("@notion-kit/ui/primitives");
    expect(source).not.toContain("convex/");
    expect(source).not.toContain("@confect/");
  });

  it("renders localized command labels", () => {
    expect(
      buildLocalizedPlatformLabels({
        locale: "en-US",
        commandPlaceholder: "Search commands",
        emptyCommandLabel: "No commands found",
      }),
    ).toEqual({
      locale: "en-US",
      commandPlaceholder: "Search commands",
      emptyCommandLabel: "No commands found",
    });
  });

  it("declares notification center empty, fake, test, and live delivery states", () => {
    const source = read("src/platform/notification-center.tsx");

    expect(source).toContain("@notion-kit/ui/primitives");
    expect(source).toContain("No notifications yet");
    expect(source).toContain("fake");
    expect(source).toContain("test");
    expect(source).toContain("live-ready");
  });

  it("declares onboarding checklist and missing live provider setup states", () => {
    const source = read("src/platform/onboarding.tsx");

    expect(source).toContain("@notion-kit/ui/primitives");
    expect(source).toContain("TemplateOnboardingChecklist");
    expect(source).toContain("missingEnv");
    expect(source).toContain("fake mode");
    expect(source).toContain("live provider setup");
  });
});
