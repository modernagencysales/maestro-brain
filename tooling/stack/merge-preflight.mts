/**
 * stack:merge-preflight — local guardrail before handing a branch to Graphite.
 * It keeps the mechanics we learned the hard way in one repeatable command:
 * fresh main, format check, Graphite dry run, and a durable merge log.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { realRunner, type Runner } from "./exec.mts";

type StackCommit = {
  readonly oid: string;
  readonly subject: string;
};

type MergeLogInput = {
  readonly branch: string;
  readonly originMain: string;
  readonly head: string;
  readonly commits: readonly StackCommit[];
  readonly warnings: readonly string[];
  readonly commands: readonly string[];
  readonly failure?: string;
  readonly createdAt: Date;
};

type MergePreflightDeps = {
  readonly now: Date;
  readonly run: Runner;
  readonly mkdir: (path: string) => void;
  readonly writeFile: (path: string, text: string) => void;
};

type MergePreflightResult = {
  readonly ok: true;
  readonly logPath: string;
  readonly warnings: readonly string[];
};

// invariant: artifact dir is a deploy-time infrastructure path, not a product-tunable value.
const ARTIFACT_DIR = "artifacts/stack-merge";

function trim(output: string): string {
  return output.trim();
}

function runAndRemember(
  commands: string[],
  run: Runner,
  command: string,
  args: readonly string[],
): string {
  commands.push([command, ...args].join(" "));
  return run(command, args);
}

function safeRun(
  commands: string[],
  run: Runner,
  command: string,
  args: readonly string[],
): string | null {
  try {
    return runAndRemember(commands, run, command, args);
  } catch {
    return null;
  }
}

function parseOnelineCommits(output: string): StackCommit[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [oid = "", ...subjectParts] = line.split(" ");
      return { oid, subject: subjectParts.join(" ") };
    });
}

export function evaluateCommitWarnings(
  commits: readonly StackCommit[],
): string[] {
  const warnings: string[] = [];
  const retriggerCount = commits.filter((commit) =>
    /^chore: retrigger\b/i.test(commit.subject),
  ).length;
  if (retriggerCount > 0) {
    warnings.push(
      `branch contains ${String(retriggerCount)} retrigger commit(s); rebase onto origin/main with only PR-specific commits before merging`,
    );
  }

  const mergedPrLike = commits.filter((commit) =>
    /\(#\d+\)$/.test(commit.subject),
  );
  if (mergedPrLike.length > 0) {
    warnings.push(
      `branch contains ${String(mergedPrLike.length)} already-merged-looking PR squash commit(s); check for downstack history before Graphite merge`,
    );
  }

  return warnings;
}

function localMainWarning(
  commands: string[],
  run: Runner,
  originMain: string,
): string | undefined {
  const localMain = safeRun(commands, run, "git", ["rev-parse", "main"]);
  if (localMain === null) return undefined;
  const localMainSha = trim(localMain);
  if (localMainSha === "" || localMainSha === originMain) return undefined;
  return `local main (${localMainSha}) differs from origin/main (${originMain}); fast-forward local main before relying on Graphite stack size`;
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function mergeLogMarkdown(input: MergeLogInput): string {
  const lines = [
    "# Stack Merge Preflight",
    "",
    `- Created: ${input.createdAt.toISOString()}`,
    `- Branch: ${input.branch}`,
    `- origin/main: ${input.originMain}`,
    `- HEAD: ${input.head}`,
    "",
    "## Commands",
    "",
    ...input.commands.map((command) => `- \`${command}\``),
    "",
    "## Commits",
    "",
    ...(input.commits.length === 0
      ? ["- No commits ahead of origin/main."]
      : input.commits.map((commit) => `- ${commit.oid} ${commit.subject}`)),
    "",
    "## Warnings",
    "",
    ...(input.warnings.length === 0
      ? ["- None."]
      : input.warnings.map((warning) => `- ${warning}`)),
    "",
    ...(input.failure === undefined
      ? []
      : ["## Failure", "", `- ${input.failure}`, ""]),
  ];
  return `${lines.join("\n")}\n`;
}

function writeMergeLog(
  deps: MergePreflightDeps,
  input: Omit<MergeLogInput, "createdAt">,
): string {
  deps.mkdir(ARTIFACT_DIR);
  const logPath = `${ARTIFACT_DIR}/${isoDate(deps.now)}-${sanitizeBranch(input.branch || "detached-head")}.md`;
  deps.writeFile(
    logPath,
    mergeLogMarkdown({
      ...input,
      branch: input.branch || "(detached HEAD)",
      createdAt: deps.now,
    }),
  );
  return logPath;
}

function failureText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function runMergePreflight(
  deps: MergePreflightDeps,
): MergePreflightResult {
  const commands: string[] = [];
  runAndRemember(commands, deps.run, "git", ["fetch", "origin", "main"]);

  const branch = trim(
    runAndRemember(commands, deps.run, "git", ["branch", "--show-current"]),
  );
  const originMain = trim(
    runAndRemember(commands, deps.run, "git", ["rev-parse", "origin/main"]),
  );
  const head = trim(
    runAndRemember(commands, deps.run, "git", ["rev-parse", "HEAD"]),
  );
  const commits = parseOnelineCommits(
    runAndRemember(commands, deps.run, "git", [
      "log",
      "--oneline",
      "origin/main..HEAD",
    ]),
  );
  const warnings = [...evaluateCommitWarnings(commits)];
  const mainWarning = localMainWarning(commands, deps.run, originMain);
  if (mainWarning !== undefined) {
    warnings.push(mainWarning);
    const logPath = writeMergeLog(deps, {
      branch,
      originMain,
      head,
      commits,
      warnings,
      commands,
      failure: mainWarning,
    });
    throw new Error(`${mainWarning}; log written to ${logPath}`);
  }

  // Keep these exact command strings stable; merge-preflight.test.mts pins them.
  // (Upstream maestro pins them via check-stacking-wiring, not ported here.)
  try {
    runAndRemember(commands, deps.run, "pnpm", ["check:format"]);
    runAndRemember(commands, deps.run, "gt", [
      "merge",
      "--dry-run",
      "--no-interactive",
    ]);
  } catch (caught) {
    const failure = failureText(caught);
    const logPath = writeMergeLog(deps, {
      branch: branch || "(detached HEAD)",
      originMain,
      head,
      commits,
      warnings,
      commands,
      failure,
    });
    throw new Error(
      `stack merge preflight failed: ${failure}; log written to ${logPath}`,
    );
  }

  const logPath = writeMergeLog(deps, {
    branch,
    originMain,
    head,
    commits,
    warnings,
    commands,
  });

  return { ok: true, logPath, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runMergePreflight({
      now: new Date(),
      run: realRunner,
      mkdir(path) {
        mkdirSync(path, { recursive: true });
      },
      writeFile(path, text) {
        writeFileSync(path, text);
      },
    });
    for (const warning of result.warnings) {
      console.warn(`! ${warning}`);
    }
    console.log(
      `✓ stack merge preflight passed; log written to ${result.logPath}`,
    );
  } catch (caught) {
    console.error(failureText(caught));
    process.exit(1);
  }
}
