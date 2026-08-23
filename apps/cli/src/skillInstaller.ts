import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import type { SetupArtifact } from "./setupOutput";

const pathExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, "code") === "ENOENT"
    )
      return false;
    throw error;
  }
};

const sortedEntries = (path: string): readonly string[] =>
  readdirSync(path).sort();

const sameEntries = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((entry, index) => entry === right[index]);

const skillEntryMatches = (source: string, destination: string): boolean => {
  const sourceStat = lstatSync(source);
  const destinationStat = lstatSync(destination);
  if (sourceStat.isDirectory() !== destinationStat.isDirectory()) return false;
  if (sourceStat.isDirectory())
    return skillDirectoriesMatch(source, destination);
  return (
    sourceStat.isFile() &&
    destinationStat.isFile() &&
    readFileSync(source).equals(readFileSync(destination))
  );
};

const skillDirectoriesMatch = (
  source: string,
  destination: string,
): boolean => {
  const sourceEntries = sortedEntries(source);
  const destinationEntries = sortedEntries(destination);
  return (
    sameEntries(sourceEntries, destinationEntries) &&
    sourceEntries.every((entry) =>
      skillEntryMatches(resolve(source, entry), resolve(destination, entry)),
    )
  );
};

const existingSkillMatches = (source: string, destination: string): boolean => {
  const destinationStat = lstatSync(destination);
  if (destinationStat.isSymbolicLink())
    return resolve(dirname(destination), readlinkSync(destination)) === source;
  return (
    destinationStat.isDirectory() && skillDirectoriesMatch(source, destination)
  );
};

export const installSkillDirectory = ({
  source,
  destination,
  artifactPath,
}: {
  readonly source: string;
  readonly destination: string;
  readonly artifactPath: string;
}): SetupArtifact => {
  if (!pathExists(source) || !lstatSync(source).isDirectory())
    return { id: "ask-apero.skill", path: artifactPath, status: "conflict" };
  if (pathExists(destination))
    return {
      id: "ask-apero.skill",
      path: artifactPath,
      status: existingSkillMatches(source, destination)
        ? "unchanged"
        : "conflict",
    };
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, errorOnExist: true });
  return { id: "ask-apero.skill", path: artifactPath, status: "created" };
};
