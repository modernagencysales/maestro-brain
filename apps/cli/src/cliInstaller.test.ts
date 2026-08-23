import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "./cliInstaller";

const roots: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "maestro-brain-cli-install-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("maestro-brain command installer", () => {
  it("creates an idempotent command symlink and reports PATH readiness", () => {
    const root = makeRoot();
    const binDirectory = join(root, "bin");
    const executable = join(root, "source.mjs");
    writeFileSync(executable, "#!/usr/bin/env node\n");

    const first = runInstallCommand(["install", "--bin-dir", binDirectory], {
      executablePath: executable,
      pathValue: binDirectory,
    });
    const second = runInstallCommand(["install", `--bin-dir=${binDirectory}`], {
      executablePath: executable,
      pathValue: binDirectory,
    });

    expect(first?.exitCode).toBe(0);
    expect(JSON.parse(first?.stdout ?? "")).toMatchObject({
      ok: true,
      status: "created",
      pathConfigured: true,
    });
    expect(JSON.parse(second?.stdout ?? "")).toMatchObject({
      ok: true,
      status: "unchanged",
    });
    const command = join(binDirectory, "maestro-brain");
    expect(lstatSync(command).isSymbolicLink()).toBe(true);
    expect(resolve(binDirectory, readlinkSync(command))).toBe(executable);
  });

  it("never replaces an existing command", () => {
    const root = makeRoot();
    const binDirectory = join(root, "bin");
    const executable = join(root, "source.mjs");
    const command = join(binDirectory, "maestro-brain");
    writeFileSync(executable, "#!/usr/bin/env node\n");
    rmSync(binDirectory, { recursive: true, force: true });
    const created = runInstallCommand(["install", "--bin-dir", binDirectory], {
      executablePath: executable,
    });
    expect(created?.exitCode).toBe(0);
    rmSync(command);
    writeFileSync(command, "owned by another installer\n");

    const result = runInstallCommand(["install", "--bin-dir", binDirectory], {
      executablePath: executable,
    });

    expect(result?.exitCode).toBe(1);
    expect(JSON.parse(result?.stdout ?? "")).toMatchObject({
      ok: false,
      status: "conflict",
      error: "Refusing to replace an existing command.",
    });
    expect(existsSync(command)).toBe(true);
  });

  it("rejects unsupported arguments without writing", () => {
    const root = makeRoot();
    const result = runInstallCommand(["install", "--force"], {
      currentDirectory: root,
      defaultBinDirectory: join(root, "bin"),
    });

    expect(result).toMatchObject({
      exitCode: 1,
      stderr: "install accepts only --bin-dir <directory>.\n",
    });
    expect(existsSync(join(root, "bin"))).toBe(false);
  });
});
