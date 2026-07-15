import { describe, expect, it } from "vitest";
import {
  expectDescriptorPassesAndFails,
  withTempRepo,
} from "./src/check-test-helpers.mts";
import { descriptor } from "./check-config-drift.mts";
import { evaluateStaticCheck } from "./src/gate.mts";

const passingFilesForDescriptor = (): Record<string, string> => {
  const files: Record<string, string> = {};

  for (const requirement of descriptor.requirements) {
    const existing = files[requirement.file] ?? "";
    files[requirement.file] =
      `${existing}\n${(requirement.includes ?? []).join("\n")}\n`;
  }

  return files;
};

describe("check:config-drift", () => {
  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("rejects shared backend notes and tenant demo seeding", async () => {
    const files = passingFilesForDescriptor();
    files["project.config.json"] += "\nsharedConvexBackendNote\n";
    files[".buildkite/scripts/staging-deploy.sh"] +=
      "\nconvex run demo/showcase:seed\n";
    files[".buildkite/scripts/production-promote.sh"] +=
      "\nconvex run demo/showcase:seed\n";

    await withTempRepo(files, async (repo) => {
      const result = await evaluateStaticCheck(repo, descriptor);

      expect(result.ok).toBe(false);
      expect(result.failures).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "project.config.json contains forbidden `sharedConvexBackendNote`",
          ),
          expect.stringContaining(
            ".buildkite/scripts/staging-deploy.sh contains forbidden `demo/showcase:seed`",
          ),
          expect.stringContaining(
            ".buildkite/scripts/production-promote.sh contains forbidden `demo/showcase:seed`",
          ),
        ]),
      );
    });
  });
});
