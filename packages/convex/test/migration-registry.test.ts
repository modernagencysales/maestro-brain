import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  assembleMigrationRegistry,
  decodeMigrationFragment,
} from "../confect/internal/migrationFragment";

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, "..");
const generatorScript = join(
  packageRoot,
  "scripts/generate-migration-registry.mts",
);

const fragments = [
  {
    schemaVersion: 1,
    taskId: "S00-T04",
    taskBlockHash:
      "14cb8f5699f656208b9a51eddb200035dfecef8159e0499a6099c3f545b2a613",
    phase: "expand",
    migrations: ["probe.expand", "probe.fail"],
    implementationModule: "../migration-implementations/S00-T04",
    dependsOn: [],
  },
  {
    schemaVersion: 1,
    taskId: "S01-T02",
    taskBlockHash:
      "f8dfea31b91e435c11203c1641f2b5fd1cefe5e966e26f4ba105b1e7088d7204",
    phase: "expand",
    migrations: [
      "stableTenant.organizationKeys.expand",
      "stableTenant.workspaceKeys.expand",
    ],
    implementationModule: "../migration-implementations/S01-T02",
    dependsOn: ["S00-T04"],
  },
  {
    schemaVersion: 1,
    taskId: "S02-T01",
    taskBlockHash:
      "dc205e57f25f69ecba7f6237744e0ce28cd01e3fab0c6cf506b7d0d7906cf6c9",
    phase: "expand",
    migrations: [],
    implementationModule: "../migration-implementations/S02-T01",
    dependsOn: ["S01-T02"],
    attestation: "no_executable_registration",
  },
  {
    schemaVersion: 1,
    taskId: "S02-T03",
    taskBlockHash:
      "05e6e953af2e5fb125d0148d86d3b93a8488961fde0c7c29cb454d7d9170f5a1",
    phase: "backfill",
    migrations: [],
    implementationModule: "../migration-implementations/S02-T03",
    dependsOn: ["S02-T01"],
    attestation: "no_executable_registration",
  },
  {
    schemaVersion: 1,
    taskId: "S05-T01",
    taskBlockHash:
      "1665eb4087239d8d137a8b4274f5f63c4bb965d699076b2678d1e618b1e34c54",
    phase: "contract",
    migrations: [],
    implementationModule: null,
    dependsOn: ["S02-T03"],
    attestation: "new_tables_only",
  },
];

describe("migration fragment registry", () => {
  it("assembles deterministic phase-aware registry bytes", () => {
    const registry = assembleMigrationRegistry([...fragments].reverse());
    expect(registry.taskIds).toEqual([
      "S00-T04",
      "S01-T02",
      "S02-T01",
      "S02-T03",
      "S05-T01",
    ]);
    expect(registry.bytes).toContain('"probe.expand"');
    expect(registry.bytes).toContain('"stableTenant.workspaceKeys.expand"');
    expect(assembleMigrationRegistry(fragments).bytes).toBe(registry.bytes);
  });

  it("strictly rejects duplicate IDs, unknown fields, unsafe modules, hash drift, phase inversion, cycles, and fake no-op migrations", () => {
    expect(() =>
      decodeMigrationFragment({ ...fragments[0], extra: true }),
    ).toThrow();
    expect(() =>
      assembleMigrationRegistry([
        {
          ...fragments[0],
          taskBlockHash:
            "0000000000000000000000000000000000000000000000000000000000000000",
        },
      ]),
    ).toThrow("task-hash drift");
    expect(() =>
      assembleMigrationRegistry([
        { ...fragments[0], implementationModule: "../../escape" },
      ]),
    ).toThrow("unsafe migration implementation path");
    expect(() =>
      assembleMigrationRegistry([fragments[0], { ...fragments[0] }]),
    ).toThrow("duplicate migration id");
    expect(() =>
      assembleMigrationRegistry([
        { ...fragments[0], migrations: ["noop.fake"] },
      ]),
    ).toThrow("fake no-op migration");
    expect(() =>
      assembleMigrationRegistry([
        { ...fragments[1], dependsOn: ["S02-T03"] },
        fragments[3],
      ]),
    ).toThrow("phase-inverted dependency");
    expect(() =>
      decodeMigrationFragment(
        '{"schemaVersion":1,"schemaVersion":1,"taskId":"S00-T04"}',
      ),
    ).toThrow("duplicate JSON key");
    expect(() =>
      assembleMigrationRegistry([{ ...fragments[0], dependsOn: ["missing"] }]),
    ).toThrow("dangling dependency");
    expect(() =>
      assembleMigrationRegistry([
        { ...fragments[0], dependsOn: ["S01-T02"] },
        { ...fragments[1], dependsOn: ["S00-T04"] },
      ]),
    ).toThrow("cycle");
    expect(() =>
      assembleMigrationRegistry([
        {
          ...fragments[4],
          taskId: "S00-T04",
          taskBlockHash:
            "14cb8f5699f656208b9a51eddb200035dfecef8159e0499a6099c3f545b2a613",
          dependsOn: [],
        },
        {
          ...fragments[0],
          taskId: "S05-T01",
          taskBlockHash:
            "1665eb4087239d8d137a8b4274f5f63c4bb965d699076b2678d1e618b1e34c54",
          dependsOn: [],
        },
      ]),
    ).toThrow("phase order");
  });

  it("writes registry bytes atomically, checks stale output, rejects symlinks, and is byte-identical twice", () => {
    const root = mkdtempSync(join(tmpdir(), "s05-registry-"));
    try {
      const dir = join(
        root,
        "packages/convex/confect/internal/migration-fragments",
      );
      execFileSync("mkdir", ["-p", dir]);
      for (const fragment of fragments)
        writeFileSync(
          join(dir, `${fragment.taskId}.json`),
          `${JSON.stringify(fragment, null, 2)}\n`,
        );
      const script = generatorScript;
      execFileSync("pnpm", ["exec", "tsx", script, "--root", root, "--write"], {
        cwd: process.cwd(),
      });
      expect(() =>
        execFileSync(
          "pnpm",
          ["exec", "tsx", script, "--root", root, "--root-cwd", "--check"],
          { cwd: process.cwd(), stdio: "pipe" },
        ),
      ).toThrow();
      const target = join(
        root,
        "packages/convex/confect/internal/migrations.generated.ts",
      );
      const first = readFileSync(target, "utf8");
      execFileSync("pnpm", ["exec", "tsx", script, "--root", root, "--check"], {
        cwd: process.cwd(),
      });
      execFileSync("pnpm", ["exec", "tsx", script, "--root-cwd", "--check"], {
        cwd: process.cwd(),
      });
      expect(() =>
        execFileSync(
          "pnpm",
          ["exec", "tsx", script, "--root", ".", "--check"],
          {
            cwd: process.cwd(),
            stdio: "pipe",
          },
        ),
      ).toThrow();
      execFileSync("pnpm", ["exec", "tsx", script, "--root", root, "--write"], {
        cwd: process.cwd(),
      });
      expect(readFileSync(target, "utf8")).toBe(first);
      writeFileSync(target, "stale\n");
      expect(() =>
        execFileSync(
          "pnpm",
          ["exec", "tsx", script, "--root", root, "--check"],
          { cwd: process.cwd(), stdio: "pipe" },
        ),
      ).toThrow();
      rmSync(target);
      execFileSync("pnpm", ["exec", "tsx", script, "--root", root, "--check"], {
        cwd: process.cwd(),
      });
      symlinkSync(join(root, "elsewhere"), target);
      expect(() =>
        execFileSync(
          "pnpm",
          ["exec", "tsx", script, "--root", root, "--write"],
          { cwd: process.cwd(), stdio: "pipe" },
        ),
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
