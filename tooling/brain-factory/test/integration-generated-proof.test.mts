import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { proveIntegrationGeneratedOutput } from "../src/integration-generated-proof.js";

const roots: string[] = [];
const git = (root: string, ...args: string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: root,
    encoding: "utf8",
  }).trim();

const repository = () => {
  const root = mkdtempSync(resolve(tmpdir(), "wave-generated-proof-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "wave@example.test");
  git(root, "config", "user.name", "Wave Test");
  writeFileSync(resolve(root, ".gitignore"), ".tokensave/\n");
  writeFileSync(resolve(root, "source.ts"), "export const source = 0;\n");
  git(root, "add", ".gitignore", "source.ts");
  git(root, "commit", "-qm", "test: base");
  const baseSha = git(root, "rev-parse", "HEAD");
  writeFileSync(resolve(root, "source.ts"), "export const source = 1;\n");
  mkdirSync(resolve(root, "generated"));
  writeFileSync(
    resolve(root, "generated/output.ts"),
    "export const value = 1;\n",
  );
  git(root, "add", ".");
  git(root, "commit", "-qm", "test: generated head");
  return { baseSha, headSha: git(root, "rev-parse", "HEAD"), root };
};

const addMigrationsWrapper = (root: string): void => {
  mkdirSync(resolve(root, "packages/convex/convex/internal"), {
    recursive: true,
  });
  writeFileSync(
    resolve(root, "packages/convex/convex/internal/migrations.ts"),
    "export const migration =\n  registeredFunctions.migration;\n",
  );
  git(root, "add", "packages/convex/convex/internal/migrations.ts");
  git(root, "commit", "-qm", "test: add migrations wrapper");
};

const addSlackConnectionsWrapper = (root: string): void => {
  mkdirSync(resolve(root, "packages/convex/convex/integrations"), {
    recursive: true,
  });
  writeFileSync(
    resolve(root, "packages/convex/convex/integrations/slackConnections.ts"),
    "export const authorize =\n  registeredFunctions.authorize;\n",
  );
  git(root, "add", "packages/convex/convex/integrations/slackConnections.ts");
  git(root, "commit", "-qm", "test: add Slack wrapper");
};

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

describe("integration generated-output proof", () => {
  it("accepts only output reproduced from exact-head source", () => {
    const value = repository();
    const formatted: string[][] = [];
    expect(
      proveIntegrationGeneratedOutput({
        ...value,
        generatedFiles: ["generated/output.ts"],
        hooks: {
          generate: (workdir) => {
            git(workdir, "checkout", "HEAD", "--", ".gitignore");
            mkdirSync(resolve(workdir, "generated"), { recursive: true });
            writeFileSync(
              resolve(workdir, "generated/output.ts"),
              "export const value=1;\n",
            );
          },
          format: (workdir, generatedFiles) => {
            formatted.push([...generatedFiles]);
            writeFileSync(
              resolve(workdir, "generated/output.ts"),
              "export const value = 1;\n",
            );
          },
          hydrate: () => undefined,
        },
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(formatted).toEqual([["generated/output.ts"]]);
  });

  it("rejects an arbitrary generated-path addition and cleans up", () => {
    const value = repository();
    expect(() =>
      proveIntegrationGeneratedOutput({
        ...value,
        generatedFiles: ["generated/output.ts"],
        hooks: {
          generate: () => undefined,
          hydrate: () => undefined,
        },
      }),
    ).toThrow("not reproducible at exact head");
    expect(git(value.root, "status", "--porcelain")).toBe("");
    expect(git(value.root, "worktree", "list", "--porcelain")).not.toContain(
      "brain-wave-generated-",
    );
  });

  it("formats the unchanged migrations wrapper after reconstructed codegen", () => {
    const original = repository();
    addMigrationsWrapper(original.root);
    const value = {
      ...original,
      headSha: git(original.root, "rev-parse", "HEAD"),
    };
    const formatted: string[][] = [];

    expect(
      proveIntegrationGeneratedOutput({
        ...value,
        generatedFiles: ["generated/output.ts"],
        hooks: {
          generate: (workdir) => {
            mkdirSync(resolve(workdir, "generated"), { recursive: true });
            writeFileSync(
              resolve(workdir, "generated/output.ts"),
              "export const value = 1;\n",
            );
            writeFileSync(
              resolve(workdir, "packages/convex/convex/internal/migrations.ts"),
              "export const migration = registeredFunctions.migration;\n",
            );
          },
          format: (workdir, generatedFiles) => {
            formatted.push([...generatedFiles]);
            writeFileSync(
              resolve(workdir, "packages/convex/convex/internal/migrations.ts"),
              "export const migration =\n  registeredFunctions.migration;\n",
            );
          },
          hydrate: () => undefined,
        },
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(formatted).toEqual([
      ["generated/output.ts", "packages/convex/convex/internal/migrations.ts"],
    ]);
  });

  it("formats a discovered tracked generated wrapper when declared output is empty", () => {
    const original = repository();
    addSlackConnectionsWrapper(original.root);
    const value = {
      ...original,
      headSha: git(original.root, "rev-parse", "HEAD"),
    };
    const formatted: string[][] = [];
    const wrapper = "packages/convex/convex/integrations/slackConnections.ts";

    expect(
      proveIntegrationGeneratedOutput({
        ...value,
        generatedFiles: [],
        hooks: {
          generate: (workdir) => {
            writeFileSync(
              resolve(workdir, wrapper),
              "export const authorize = registeredFunctions.authorize;\n",
            );
          },
          format: (workdir, generatedFiles) => {
            formatted.push([...generatedFiles]);
            writeFileSync(
              resolve(workdir, wrapper),
              "export const authorize =\n  registeredFunctions.authorize;\n",
            );
          },
          hydrate: () => undefined,
        },
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(formatted).toEqual([[wrapper]]);
  });

  it("rejects a discovered non-generated tracked change", () => {
    const value = repository();

    expect(() =>
      proveIntegrationGeneratedOutput({
        ...value,
        generatedFiles: [],
        hooks: {
          generate: (workdir) => {
            writeFileSync(
              resolve(workdir, "source.ts"),
              "export const source = 2;\n",
            );
          },
          hydrate: () => undefined,
        },
      }),
    ).toThrow(/changed non-generated files.*source\.ts/);
  });
});
