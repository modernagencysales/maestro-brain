import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { runRtk } from "./process.js";

type Runner = (
  args: readonly string[],
  options?: { readonly cwd?: string; readonly quiet?: boolean },
) => string;

const workspaceRoots = ["apps", "packages", "tooling"] as const;

const packageManifestPaths = (root: string): readonly string[] => {
  const paths = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
  for (const workspaceRoot of workspaceRoots) {
    const directory = resolve(root, workspaceRoot);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = resolve(directory, entry.name, "package.json");
      if (existsSync(manifest)) paths.push(relative(root, manifest));
    }
  }
  return paths.sort();
};

const manifestsMatch = (root: string, workdir: string): boolean => {
  const rootPaths = packageManifestPaths(root);
  const workdirPaths = packageManifestPaths(workdir);
  if (rootPaths.join("\n") !== workdirPaths.join("\n")) return false;
  return rootPaths.every((path) => {
    const source = resolve(root, path);
    const target = resolve(workdir, path);
    return (
      existsSync(source) &&
      existsSync(target) &&
      readFileSync(source).equals(readFileSync(target))
    );
  });
};

const linkDependencies = (root: string, workdir: string): number => {
  const directories = [
    "node_modules",
    ...packageManifestPaths(root)
      .filter((path) => path.endsWith("/package.json"))
      .map((path) => join(dirname(path), "node_modules")),
  ];
  let linked = 0;
  for (const path of directories) {
    const source = resolve(root, path);
    const target = resolve(workdir, path);
    if (!existsSync(source) || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target, "junction");
    linked += 1;
  }
  return linked;
};

export const hydrateWorktreeDependencies = (
  root: string,
  workdir: string,
  runner: Runner = runRtk,
): { readonly linked: number; readonly mode: "installed" | "linked" } => {
  if (manifestsMatch(root, workdir)) {
    return { linked: linkDependencies(root, workdir), mode: "linked" };
  }
  runner(
    [
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    { cwd: workdir },
  );
  return { linked: 0, mode: "installed" };
};
