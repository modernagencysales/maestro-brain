import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSeedAttemptTimeout,
  readLocalAdminKeyForPort,
} from "../../tests/acceptance/support/runtime";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("contracts runtime seed retries", () => {
  it.each([
    [120_000, 120_000, 15_000, 15_000],
    [10_000, 120_000, 15_000, 10_000],
    [120_000, 5_000, 15_000, 5_000],
    [0, 120_000, 15_000, 1],
  ])(
    "bounds one seed attempt without consuming the overall deadline",
    (remaining, command, attempt, expected) => {
      expect(boundedSeedAttemptTimeout(remaining, command, attempt)).toBe(
        expected,
      );
    },
  );
});

describe("local Convex credential selection", () => {
  it("selects the deployment that owns the exact cloud port", async () => {
    const root = await mkdtemp(join(tmpdir(), "contracts-local-convex-"));
    temporaryRoots.push(root);
    for (const [name, cloud, adminKey] of [
      ["other", 31_000, "other-admin-key"],
      ["acceptance", 32_000, "acceptance-admin-key"],
    ] as const) {
      const directory = join(root, ".convex", "local", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "config.json"),
        JSON.stringify({ adminKey, ports: { cloud, site: cloud + 1 } }),
      );
    }

    await expect(readLocalAdminKeyForPort(root, 32_000)).resolves.toBe(
      "acceptance-admin-key",
    );
  });

  it("fails closed when no deployment owns the requested port", async () => {
    const root = await mkdtemp(join(tmpdir(), "contracts-local-convex-"));
    temporaryRoots.push(root);
    const directory = join(root, ".convex", "local", "default");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({ adminKey: "not-for-this-port", ports: { cloud: 1 } }),
    );

    await expect(readLocalAdminKeyForPort(root, 2)).rejects.toThrow(
      "matched cloud port 2",
    );
  });
});
