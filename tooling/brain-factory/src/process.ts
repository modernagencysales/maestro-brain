import { spawnSync } from "node:child_process";

export const runRtk = (
  args: readonly string[],
  options: { readonly cwd?: string; readonly quiet?: boolean } = {},
): string => {
  const result = spawnSync("rtk", [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0)
    throw new Error(
      `rtk ${args.join(" ")} failed (${result.status ?? "unknown"})`,
    );
  return result.stdout.trim();
};
