import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { evaluateStaticCheck, type StaticCheckDescriptor } from "./gate.mts";

export async function withTempRepo<T>(
  files: Record<string, string>,
  run: (repo: string) => Promise<T>,
): Promise<T> {
  const repo = await mkdtemp(join(tmpdir(), "maestro-template-check-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(repo, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    }
    return await run(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

export async function expectDescriptorPassesAndFails(
  descriptor: StaticCheckDescriptor,
): Promise<void> {
  const passingFiles: Record<string, string> = {};

  for (const requirement of descriptor.requirements) {
    const existing = passingFiles[requirement.file] ?? "";
    passingFiles[requirement.file] =
      `${existing}\n${(requirement.includes ?? []).join("\n")}\n`;
  }

  const passing = await withTempRepo(passingFiles, (repo) =>
    evaluateStaticCheck(repo, descriptor),
  );
  expect(passing.ok).toBe(true);

  const first = descriptor.requirements[0];
  if (first === undefined) {
    throw new Error(`${descriptor.name} has no requirements`);
  }

  const failing = await withTempRepo({}, (repo) =>
    evaluateStaticCheck(repo, descriptor),
  );
  expect(failing.ok).toBe(false);
  expect(failing.failures[0]).toContain(first.message);
}
