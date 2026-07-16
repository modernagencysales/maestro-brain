import type { GateProfile } from "./manifest.js";

export interface GateCommand {
  readonly args: readonly string[];
  readonly program: string;
}

export const S02_T02_FOCUSED_COMMANDS = [
  "rtk pnpm brain:factory:check-confect-codegen -- --check confect-contracts --check headless-surface-contract --profile web --test brain-pages --test editor-sync --test http-docs --test confect-contracts --test workspace-access --test headless-executor --test observability-error-capture",
  "rtk host-test-slot --class focused pnpm --dir apps/cli test",
  "rtk host-test-slot --class focused pnpm --dir tooling/workflow test",
] as const;

export const focusedCommandContractIssues = (
  taskId: string,
  commands: readonly string[],
): string[] => {
  if (taskId !== "S02-T02") return [];
  return JSON.stringify(commands) === JSON.stringify(S02_T02_FOCUSED_COMMANDS)
    ? []
    : ["S02-T02 focused commands must match the transient snapshot contract"];
};

const unsafeShellToken = /[;&|<>`$\\'"]/;

export const focusedGateCommand = (value: string): GateCommand => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("rtk "))
    throw new Error("focused gate must start with `rtk `");
  if (unsafeShellToken.test(trimmed))
    throw new Error("focused gate must not contain shell syntax or quoting");
  const [program, ...args] = trimmed.slice(4).trim().split(/\s+/);
  if (!program) throw new Error("focused gate has no program");
  const normalized = [program, ...args].join(" ");
  if (
    /^pnpm (?:(?:--dir packages\/convex )?(?:confect:codegen|check:convex)|confect:manifest)(?:\s|$)/.test(
      normalized,
    )
  )
    throw new Error(
      "generated-tree mutator must use `pnpm brain:factory:check-confect-codegen`",
    );
  if (
    /^(?:pnpm (?:verify|test|typecheck)|just verify(?:-full)?)(?:\s|$)/.test(
      normalized,
    ) ||
    /(?:^|\s)(?:pr:preflight|check:debt|check:gates)(?:\s|$)/.test(normalized)
  )
    throw new Error("broad command recorded as a lane-focused gate");
  return { program, args };
};

export const lintCommandForFiles = (
  files: readonly string[],
): GateCommand | undefined => {
  const lintable = [
    ...new Set(files.filter((file) => /\.[cm]?[jt]sx?$/.test(file))),
  ];
  return lintable.length > 0
    ? { program: "pnpm", args: ["exec", "eslint", ...lintable] }
    : undefined;
};

export const formatCommandForFiles = (
  files: readonly string[],
): GateCommand | undefined => {
  const existing = [...new Set(files)];
  return existing.length > 0
    ? {
        program: "pnpm",
        args: ["exec", "prettier", "--check", "--ignore-unknown", ...existing],
      }
    : undefined;
};

const packageGate = (directory: string): readonly GateCommand[] => [
  { program: "pnpm", args: ["--dir", directory, "typecheck"] },
  {
    program: "host-test-slot",
    args: ["--class", "focused", "pnpm", "--dir", directory, "test"],
  },
];

export const validatesTransientConfectSnapshot = (
  command: GateCommand,
): boolean => {
  if (
    command.program !== "pnpm" ||
    command.args[0] !== "brain:factory:check-confect-codegen"
  ) {
    return false;
  }
  const testFlag = command.args.indexOf("--test");
  return testFlag >= 0 && Boolean(command.args[testFlag + 1]);
};

export const validatesTransientConfectProfile = (
  command: GateCommand,
  profile: "web",
): boolean => {
  if (!validatesTransientConfectSnapshot(command)) return false;
  return command.args.some(
    (argument, index) =>
      argument === "--profile" && command.args[index + 1] === profile,
  );
};

export const commandsForProfiles = (
  profiles: readonly GateProfile[],
  focusedCommands: readonly GateCommand[] = [],
): GateCommand[] => {
  const commands: GateCommand[] = [];
  const generatedConfectSnapshot = focusedCommands.some(
    validatesTransientConfectSnapshot,
  );
  const transientWebSnapshot = focusedCommands.some((command) =>
    validatesTransientConfectProfile(command, "web"),
  );
  const seen = new Set<string>();
  const add = (command: GateCommand): void => {
    const key = `${command.program}\0${command.args.join("\0")}`;
    if (!seen.has(key)) {
      seen.add(key);
      commands.push(command);
    }
  };
  for (const profile of profiles) {
    const profileCommands: readonly GateCommand[] =
      profile === "convex"
        ? generatedConfectSnapshot
          ? []
          : packageGate("packages/convex")
        : profile === "web"
          ? transientWebSnapshot
            ? []
            : packageGate("apps/web")
          : profile === "integrations"
            ? packageGate("packages/integrations")
            : profile === "evals"
              ? packageGate("tooling/evals")
              : profile === "generators"
                ? packageGate("tooling/generators")
                : profile === "search"
                  ? packageGate("packages/search")
                  : profile === "cli"
                    ? packageGate("apps/cli")
                    : profile === "template-core"
                      ? packageGate("packages/template-core")
                      : profile === "release"
                        ? [
                            ...packageGate("tooling/release"),
                            {
                              program: "pnpm",
                              args: ["check:config-drift"],
                            },
                          ]
                        : profile === "tooling"
                          ? []
                          : [];
    for (const command of profileCommands) add(command);
  }
  return commands;
};
