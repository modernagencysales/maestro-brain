import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CONTRACT_FILE = "canonical-launch.json";

type CanonicalLaunchContract = Readonly<{
  schemaVersion: 1;
  repository: string;
  defaultBranch: string;
  requiredAncestor: string;
  templateRelease: string;
  requiredPaths: readonly string[];
  requiredText: Readonly<Record<string, string>>;
  requiredEmptyArrays: readonly string[];
}>;

export type CanonicalLaunchGuardDependencies = Readonly<{
  readText: (path: string) => Promise<string>;
  pathExists: (path: string) => Promise<boolean>;
  git: (cwd: string, args: readonly string[]) => Promise<string>;
  portOwners: (port: number) => Promise<readonly number[]>;
  processCwd: (pid: number) => Promise<string | undefined>;
}>;

const nodeDependencies: CanonicalLaunchGuardDependencies = {
  readText: (path) => readFile(path, "utf8"),
  pathExists: async (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  git: async (cwd, args) =>
    (await execFileAsync("git", [...args], { cwd })).stdout.trim(),
  portOwners: async (port) => {
    try {
      const output = (
        await execFileAsync("lsof", [
          "-nP",
          `-iTCP:${port}`,
          "-sTCP:LISTEN",
          "-Fp",
        ])
      ).stdout;
      return [
        ...new Set(
          output
            .split(/\r?\n/gu)
            .filter((line) => /^p\d+$/u.test(line))
            .map((line) => Number(line.slice(1))),
        ),
      ];
    } catch {
      return [];
    }
  },
  processCwd: async (pid) => {
    try {
      const output = (
        await execFileAsync("lsof", [
          "-a",
          "-p",
          String(pid),
          "-d",
          "cwd",
          "-Fn",
        ])
      ).stdout;
      return output
        .split(/\r?\n/gu)
        .find((line) => line.startsWith("n"))
        ?.slice(1);
    } catch {
      return undefined;
    }
  },
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const stringArray = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;

const hasStringProperties = (
  value: Record<string, unknown> | undefined,
  properties: readonly string[],
): boolean =>
  properties.every((property) => typeof value?.[property] === "string");

const parseContract = (raw: string): CanonicalLaunchContract => {
  const value = asRecord(JSON.parse(raw));
  const requiredText = asRecord(value?.requiredText);
  const entries = requiredText && Object.entries(requiredText);
  if (value?.schemaVersion !== 1) {
    throw new Error("canonical-launch.json is invalid.");
  }
  if (
    !hasStringProperties(value, [
      "repository",
      "defaultBranch",
      "requiredAncestor",
      "templateRelease",
    ])
  ) {
    throw new Error("canonical-launch.json is invalid.");
  }
  if (stringArray(value.requiredPaths) === undefined) {
    throw new Error("canonical-launch.json is invalid.");
  }
  if (stringArray(value.requiredEmptyArrays) === undefined) {
    throw new Error("canonical-launch.json is invalid.");
  }
  if (entries === undefined) {
    throw new Error("canonical-launch.json is invalid.");
  }
  if (entries.some(([, text]) => typeof text !== "string")) {
    throw new Error("canonical-launch.json is invalid.");
  }
  return value as CanonicalLaunchContract;
};

const repositoryFromRemote = (remote: string): string | undefined => {
  const normalized = remote.trim().replace(/\.git$/u, "");
  const match = /(?:github\.com[/:])([^/]+\/[^/]+)$/u.exec(normalized);
  return match?.[1];
};

const webPortFrom = (argv: readonly string[]): number | undefined => {
  const index = argv.indexOf("--web-port");
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && /^\d+$/u.test(value) ? Number(value) : undefined;
};

const belongsToRoot = (root: string, candidate: string): boolean => {
  const distance = relative(resolve(root), resolve(candidate));
  return (
    distance === "" || (!distance.startsWith("..") && !isAbsolute(distance))
  );
};

const isEmptyArray = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 0;

const gitSucceeds = async (
  dependencies: CanonicalLaunchGuardDependencies,
  cwd: string,
  args: readonly string[],
): Promise<boolean> => {
  try {
    await dependencies.git(cwd, args);
    return true;
  } catch {
    return false;
  }
};

const optionalGitOutput = async (
  dependencies: CanonicalLaunchGuardDependencies,
  cwd: string,
  args: readonly string[],
): Promise<string | undefined> => {
  try {
    return await dependencies.git(cwd, args);
  } catch {
    return undefined;
  }
};

const exactCommitSha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

const remoteDefaultBranchCommit = async (
  dependencies: CanonicalLaunchGuardDependencies,
  cwd: string,
  defaultBranch: string,
): Promise<string> => {
  const remoteRef = `refs/remotes/origin/${defaultBranch}`;
  const localCommit = await optionalGitOutput(dependencies, cwd, [
    "rev-parse",
    "--verify",
    `${remoteRef}^{commit}`,
  ]);
  if (localCommit !== undefined && exactCommitSha.test(localCommit))
    return localCommit;

  const headRef = `refs/heads/${defaultBranch}`;
  const remoteOutput = await dependencies.git(cwd, [
    "ls-remote",
    "--exit-code",
    "origin",
    headRef,
  ]);
  const [remoteCommit, returnedRef, ...unexpected] = remoteOutput
    .trim()
    .split(/\s+/u);
  if (
    remoteCommit === undefined ||
    !exactCommitSha.test(remoteCommit) ||
    returnedRef !== headRef ||
    unexpected.length > 0
  )
    throw new Error(`origin/${defaultBranch} is unavailable`);
  return remoteCommit;
};

const repositoryFindings = async (
  cwd: string,
  contract: CanonicalLaunchContract,
  dependencies: CanonicalLaunchGuardDependencies,
): Promise<readonly string[]> => {
  const findings: string[] = [];
  const root = await dependencies.git(cwd, ["rev-parse", "--show-toplevel"]);
  if (resolve(root) !== resolve(cwd))
    findings.push(`Start from the canonical repository root: ${root}`);

  const remote = await dependencies.git(cwd, [
    "config",
    "--get",
    "remote.origin.url",
  ]);
  if (repositoryFromRemote(remote) !== contract.repository)
    findings.push(
      `origin must be ${contract.repository}; received ${remote || "missing"}`,
    );

  const remoteHead = await optionalGitOutput(dependencies, cwd, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  ]);
  if (
    remoteHead !== undefined &&
    remoteHead !== `refs/remotes/origin/${contract.defaultBranch}`
  )
    findings.push(`origin/HEAD must point to ${contract.defaultBranch}.`);

  if (
    !(await gitSucceeds(dependencies, cwd, [
      "merge-base",
      "--is-ancestor",
      await remoteDefaultBranchCommit(
        dependencies,
        cwd,
        contract.defaultBranch,
      ),
      "HEAD",
    ]))
  )
    findings.push(`HEAD is behind origin/${contract.defaultBranch}.`);

  if (
    !(await gitSucceeds(dependencies, cwd, [
      "merge-base",
      "--is-ancestor",
      contract.requiredAncestor,
      "HEAD",
    ]))
  )
    findings.push(
      `HEAD does not contain canonical shell ${contract.requiredAncestor}.`,
    );

  return findings;
};

const artifactFindings = async (
  cwd: string,
  contract: CanonicalLaunchContract,
  dependencies: CanonicalLaunchGuardDependencies,
): Promise<readonly string[]> => {
  const findings: string[] = [];
  const instance = asRecord(
    JSON.parse(
      await dependencies.readText(resolve(cwd, "template-instance.json")),
    ),
  );
  const release = asRecord(instance?.release);
  if (release?.tag !== contract.templateRelease)
    findings.push(
      `template-instance.json must use ${contract.templateRelease}.`,
    );

  for (const path of contract.requiredPaths) {
    if (!(await dependencies.pathExists(resolve(cwd, path))))
      findings.push(`Canonical launch path is missing: ${path}`);
  }
  for (const [path, expected] of Object.entries(contract.requiredText)) {
    if (!(await dependencies.readText(resolve(cwd, path))).includes(expected))
      findings.push(`Canonical launch provenance is stale: ${path}`);
  }
  for (const path of contract.requiredEmptyArrays) {
    const value: unknown = JSON.parse(
      await dependencies.readText(resolve(cwd, path)),
    );
    if (!isEmptyArray(value))
      findings.push(`Canonical UI deviations must remain empty: ${path}`);
  }

  return findings;
};

const portFindings = async (
  cwd: string,
  argv: readonly string[],
  dependencies: CanonicalLaunchGuardDependencies,
): Promise<readonly string[]> => {
  const webPort = webPortFrom(argv);
  if (webPort === undefined) return [];

  const findings: string[] = [];
  for (const pid of await dependencies.portOwners(webPort)) {
    const ownerCwd = await dependencies.processCwd(pid);
    findings.push(
      ownerCwd && !belongsToRoot(cwd, ownerCwd)
        ? `Web port ${webPort} is owned by stale checkout ${ownerCwd} (pid ${pid}).`
        : `Web port ${webPort} is already owned by pid ${pid}.`,
    );
  }
  return findings;
};

async function inspectCanonicalLaunch(
  cwd: string,
  argv: readonly string[],
  dependencies: CanonicalLaunchGuardDependencies,
): Promise<readonly string[]> {
  const contractPath = resolve(cwd, CONTRACT_FILE);
  if (!(await dependencies.pathExists(contractPath))) return [];
  const findings: string[] = [];
  let contract: CanonicalLaunchContract;
  try {
    contract = parseContract(await dependencies.readText(contractPath));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const sections = await Promise.all([
    repositoryFindings(cwd, contract, dependencies),
    artifactFindings(cwd, contract, dependencies),
    portFindings(cwd, argv, dependencies),
  ]);
  findings.push(...sections.flat());
  return findings;
}

export async function canonicalLaunchFindings(
  cwd: string,
  argv: readonly string[],
  dependencies: CanonicalLaunchGuardDependencies = nodeDependencies,
): Promise<readonly string[]> {
  try {
    return await inspectCanonicalLaunch(cwd, argv, dependencies);
  } catch (error) {
    return [
      `Canonical launch verification failed: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}
