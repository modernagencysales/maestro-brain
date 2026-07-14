import type { GateProfile } from "./manifest.js";

export interface GateCommand {
  readonly args: readonly string[];
  readonly program: string;
}

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

const packageGate = (directory: string): readonly GateCommand[] => [
  { program: "pnpm", args: ["--dir", directory, "typecheck"] },
  {
    program: "host-test-slot",
    args: ["--class", "focused", "pnpm", "--dir", directory, "test"],
  },
];

export const commandsForProfiles = (
  profiles: readonly GateProfile[],
): GateCommand[] => {
  const commands: GateCommand[] = [];
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
        ? packageGate("packages/convex")
        : profile === "web"
          ? packageGate("apps/web")
          : profile === "integrations"
            ? packageGate("packages/integrations")
            : profile === "search"
              ? packageGate("packages/search")
              : profile === "cli"
                ? packageGate("apps/cli")
                : profile === "template-core"
                  ? packageGate("packages/template-core")
                  : profile === "release"
                    ? packageGate("tooling/release")
                    : profile === "tooling"
                      ? [
                          ...packageGate("tooling/evals"),
                          ...packageGate("tooling/generators"),
                        ]
                      : [];
    for (const command of profileCommands) add(command);
  }
  return commands;
};
