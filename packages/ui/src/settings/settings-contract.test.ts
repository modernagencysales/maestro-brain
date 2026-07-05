import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("Notion settings boundary contract", () => {
  it("adapts Notion Kit settings-panel primitives through packages/ui", () => {
    const settings = read("src/settings/template-settings-panel.tsx");

    expect(settings).toContain("@notion-kit/settings-panel");
    expect(settings).toContain("SettingsProvider");
    expect(settings).toContain("SettingsPanel");
    expect(settings).toContain("SettingsSidebar");
    expect(settings).toContain("SettingsContent");
    expect(settings).toContain("createMockAdapters");
    expect(settings).toContain("TemplateSettingsPanel");
  });

  it("exports the settings adapter from the public UI package surface", () => {
    const packageJson = read("package.json");

    expect(packageJson).toContain('"./settings"');
    expect(packageJson).toContain(
      "./dist/src/settings/template-settings-panel.js",
    );
  });
});
