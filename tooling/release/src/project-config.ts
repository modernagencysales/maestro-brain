import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ProjectEnvironmentName = "staging" | "production";

export type ProjectEnvironment = {
  readonly name: ProjectEnvironmentName;
  readonly domain: string;
  readonly cloudflarePagesProject: string;
  readonly cloudflareBranch: string;
  readonly convexDeployName: string;
  readonly convexUrl?: string;
  readonly convexDeployKeyEnv?: string;
  readonly callbackOriginEnv?: string;
  readonly requiredEnvGroups: readonly string[];
  readonly requiredSecrets: readonly string[];
};

export type ProjectConfig = {
  readonly project: { readonly name: string };
  readonly environments: Record<ProjectEnvironmentName, ProjectEnvironment>;
};

export const readProjectConfigFile = (repoRoot: string): ProjectConfig => {
  const path = resolve(repoRoot, "project.config.json");
  return JSON.parse(readFileSync(path, "utf8")) as ProjectConfig;
};
