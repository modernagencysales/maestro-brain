import { describe, expect, it } from "vitest";

import {
  canonicalLaunchFindings,
  type CanonicalLaunchGuardDependencies,
} from "./canonicalLaunchGuard";

const contract = JSON.stringify({
  schemaVersion: 1,
  repository: "modernagencysales/maestro-brain",
  defaultBranch: "main",
  requiredAncestor: "shell-sha",
  templateRelease: "maestro-template-v0.2.0-alpha.9",
  requiredPaths: ["route.tsx", "deviations.json"],
  requiredText: { "route.tsx": "ConnectionsPage" },
  requiredEmptyArrays: ["deviations.json"],
});
const mainSha = "a".repeat(40);

const dependencies = (
  overrides: Partial<CanonicalLaunchGuardDependencies> = {},
): CanonicalLaunchGuardDependencies => ({
  readText: async (path) => {
    if (path.endsWith("canonical-launch.json")) return contract;
    if (path.endsWith("template-instance.json"))
      return JSON.stringify({
        release: { tag: "maestro-template-v0.2.0-alpha.9" },
      });
    if (path.endsWith("deviations.json")) return "[]";
    return "export const ConnectionsPage = true";
  },
  pathExists: async () => true,
  git: async (_cwd, args) => {
    const command = args.join(" ");
    if (command === "rev-parse --show-toplevel") return "/repo";
    if (command === "config --get remote.origin.url")
      return "https://github.com/modernagencysales/maestro-brain.git";
    if (command === "symbolic-ref refs/remotes/origin/HEAD")
      return "refs/remotes/origin/main";
    if (command === "rev-parse --verify refs/remotes/origin/main^{commit}")
      return mainSha;
    if (command.startsWith("merge-base --is-ancestor")) return "";
    throw new Error(`Unexpected git command: ${command}`);
  },
  portOwners: async () => [],
  processCwd: async () => undefined,
  ...overrides,
});

describe("canonical customer launch guard", () => {
  it("accepts the current canonical shell checkout", async () => {
    await expect(
      canonicalLaunchFindings(
        "/repo",
        ["start", "--web-port", "15173"],
        dependencies(),
      ),
    ).resolves.toEqual([]);
  });

  it("rejects the wrong repository and a branch behind main", async () => {
    const base = dependencies();
    const findings = await canonicalLaunchFindings(
      "/repo",
      ["start"],
      dependencies({
        git: async (cwd, args) => {
          const command = args.join(" ");
          if (command === "config --get remote.origin.url")
            return "https://github.com/example/old-ui.git";
          if (command === `merge-base --is-ancestor ${mainSha} HEAD`)
            throw new Error("not an ancestor");
          return base.git(cwd, args);
        },
      }),
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("origin must be"),
        expect.stringContaining("behind origin/main"),
      ]),
    );
  });

  it("names a stale checkout that owns the selected port", async () => {
    await expect(
      canonicalLaunchFindings(
        "/repo",
        ["start", "--web-port", "15173"],
        dependencies({
          portOwners: async () => [42],
          processCwd: async () => "/private/tmp/old-maestro-brain",
        }),
      ),
    ).resolves.toContain(
      "Web port 15173 is owned by stale checkout /private/tmp/old-maestro-brain (pid 42).",
    );
  });

  it("reports a child process from the canonical checkout without calling it stale", async () => {
    await expect(
      canonicalLaunchFindings(
        "/repo",
        ["start", "--web-port", "15173"],
        dependencies({
          portOwners: async () => [43],
          processCwd: async () => "/repo/apps/web",
        }),
      ),
    ).resolves.toContain("Web port 15173 is already owned by pid 43.");
  });

  it("accepts CI clones that resolve the contract branch without remote refs", async () => {
    const base = dependencies();
    await expect(
      canonicalLaunchFindings(
        "/repo",
        ["start"],
        dependencies({
          git: async (cwd, args) => {
            const command = args.join(" ");
            if (command === "symbolic-ref refs/remotes/origin/HEAD")
              throw new Error("origin/HEAD is unavailable");
            if (
              command === "rev-parse --verify refs/remotes/origin/main^{commit}"
            )
              throw new Error("origin/main is unavailable");
            if (command === "ls-remote --exit-code origin refs/heads/main")
              return `${mainSha}\trefs/heads/main`;
            return base.git(cwd, args);
          },
        }),
      ),
    ).resolves.toEqual([]);
  });

  it("fails closed when neither local nor remote contract branch authority is available", async () => {
    const base = dependencies();
    await expect(
      canonicalLaunchFindings(
        "/repo",
        ["start"],
        dependencies({
          git: async (cwd, args) => {
            const command = args.join(" ");
            if (
              command ===
                "rev-parse --verify refs/remotes/origin/main^{commit}" ||
              command === "ls-remote --exit-code origin refs/heads/main"
            )
              throw new Error("contract branch is unavailable");
            return base.git(cwd, args);
          },
        }),
      ),
    ).resolves.toEqual([
      "Canonical launch verification failed: contract branch is unavailable",
    ]);
  });

  it("rejects an available origin HEAD that points away from the contract branch", async () => {
    const base = dependencies();
    await expect(
      canonicalLaunchFindings(
        "/repo",
        ["start"],
        dependencies({
          git: async (cwd, args) => {
            if (args.join(" ") === "symbolic-ref refs/remotes/origin/HEAD")
              return "refs/remotes/origin/legacy";
            return base.git(cwd, args);
          },
        }),
      ),
    ).resolves.toContain("origin/HEAD must point to main.");
  });

  it("fails closed with a useful diagnostic when repository verification cannot complete", async () => {
    await expect(
      canonicalLaunchFindings(
        "/repo",
        ["start"],
        dependencies({
          git: async () => {
            throw new Error("repository metadata is unavailable");
          },
        }),
      ),
    ).resolves.toEqual([
      "Canonical launch verification failed: repository metadata is unavailable",
    ]);
  });
});
