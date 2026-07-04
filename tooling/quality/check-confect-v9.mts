import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDirectRun } from "./src/direct-run.mts";

export type V9Finding = {
  readonly file: string;
  readonly message: string;
};

type PackageJson = {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

const packageFiles = [
  "packages/convex/package.json",
  "apps/web/package.json",
  "apps/cli/package.json",
  "tooling/effectified-api-proof/package.json",
] as const;

const readJson = (repoRoot: string, path: string): PackageJson =>
  JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as PackageJson;

const walk = (repoRoot: string, dir: string): readonly string[] => {
  const fullDir = join(repoRoot, dir);
  if (!existsSync(fullDir)) return [];

  const out: string[] = [];
  for (const entry of readdirSync(fullDir)) {
    const path = join(dir, entry);
    const stat = statSync(join(repoRoot, path));
    if (stat.isDirectory()) out.push(...walk(repoRoot, path));
    if (stat.isFile()) out.push(path);
  }
  return out;
};

const readSource = (repoRoot: string, file: string): string =>
  readFileSync(join(repoRoot, file), "utf8");

export const checkConfectPackagePins = (
  repoRoot = process.cwd(),
): readonly V9Finding[] => {
  const findings: V9Finding[] = [];
  const observed = new Map<string, string>();

  for (const file of packageFiles) {
    const pkg = readJson(repoRoot, file);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      if (!name.startsWith("@confect/")) continue;
      if (!version.startsWith("9.")) {
        findings.push({
          file,
          message: `${name} must stay on Confect v9, found ${version}`,
        });
      }
      observed.set(`${file}:${name}`, version);
    }
  }

  const versions = new Set(observed.values());
  if (versions.size > 1) {
    findings.push({
      file: "package.json",
      message: `All @confect/* packages must share one exact v9 patch, found ${[...versions].sort().join(", ")}`,
    });
  }

  return findings;
};

export const checkNoAggregateConfectEntrypoints = (
  repoRoot = process.cwd(),
): readonly V9Finding[] =>
  ["spec.ts", "impl.ts", "nodeSpec.ts", "nodeImpl.ts"]
    .map((name) => `packages/convex/confect/${name}`)
    .filter((file) => existsSync(join(repoRoot, file)))
    .map((file) => ({
      file,
      message: "Confect v9 removes root aggregate spec/impl entrypoints.",
    }));

export const checkNoEffectBarrelImports = (
  repoRoot = process.cwd(),
): readonly V9Finding[] =>
  walk(repoRoot, "packages/convex/confect")
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const source = readSource(repoRoot, file);
      return /from\s+["']effect["']/.test(source)
        ? [
            {
              file,
              message:
                "Import Effect submodules, not the effect barrel, inside confect/.",
            },
          ]
        : [];
    });

export const checkLazySpecSchemas = (
  repoRoot = process.cwd(),
): readonly V9Finding[] =>
  walk(repoRoot, "packages/convex/confect")
    .filter((file) => file.endsWith(".spec.ts"))
    .flatMap((file) => {
      const source = readSource(repoRoot, file);
      const findings: V9Finding[] = [];
      if (/GroupSpec\.make(Node)?\(\s*["']/.test(source)) {
        findings.push({
          file,
          message: "GroupSpec.make does not take a name in Confect v9.",
        });
      }

      let inFunctionSpec = false;
      for (const line of source.split("\n")) {
        if (/FunctionSpec\.[A-Za-z]+\(\s*\{/.test(line)) {
          inFunctionSpec = true;
        }
        const schemaProperty = line.match(/^\s*(args|returns|error):\s*(.*)$/);
        if (
          inFunctionSpec &&
          schemaProperty &&
          !schemaProperty[2].trimStart().startsWith("() =>")
        ) {
          findings.push({
            file,
            message: `${schemaProperty[1]} schema must be wrapped in a () => thunk.`,
          });
        }
        if (inFunctionSpec && /^\s*\}\);/.test(line)) {
          inFunctionSpec = false;
        }
      }

      return findings;
    });

export const checkImplsUseDatabaseSchema = (
  repoRoot = process.cwd(),
): readonly V9Finding[] =>
  walk(repoRoot, "packages/convex/confect")
    .filter((file) => file.endsWith(".impl.ts"))
    .flatMap((file) => {
      const source = readSource(repoRoot, file);
      const findings: V9Finding[] = [];

      if (
        source.includes("FunctionImpl.make(api") ||
        source.includes("GroupImpl.make(api")
      ) {
        findings.push({
          file,
          message:
            "Impls must pass generated databaseSchema, not an aggregate api.",
        });
      }
      if (
        !/import\s+databaseSchema\s+from\s+["'][^"']*_generated\/schema["']/.test(
          source,
        )
      ) {
        findings.push({
          file,
          message: "Impls must import generated databaseSchema.",
        });
      }
      if (
        source.includes("FunctionImpl.make(") &&
        !/FunctionImpl\.make\(\s*databaseSchema/.test(source)
      ) {
        findings.push({
          file,
          message: "FunctionImpl.make must receive generated databaseSchema.",
        });
      }
      if (!/GroupImpl\.make\(\s*databaseSchema/.test(source)) {
        findings.push({
          file,
          message: "GroupImpl.make must receive generated databaseSchema.",
        });
      }
      if (!source.includes("GroupImpl.finalize")) {
        findings.push({
          file,
          message: "Impls must end with GroupImpl.finalize.",
        });
      }

      return findings;
    });

export const checkTableShape = (
  repoRoot = process.cwd(),
): readonly V9Finding[] =>
  walk(repoRoot, "packages/convex/confect/tables")
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const source = readSource(repoRoot, file);
      const findings: V9Finding[] = [];

      if (!source.includes("export default Table.make(() =>")) {
        findings.push({
          file,
          message: "Tables must default-export Table.make(() => ...).",
        });
      }
      if (/Table\.make\(\s*["']/.test(source)) {
        findings.push({
          file,
          message:
            "Table.make no longer takes a table-name argument in Confect v9.",
        });
      }

      return findings;
    });

export const collectConfectV9Findings = (
  repoRoot = process.cwd(),
): readonly V9Finding[] => [
  ...checkConfectPackagePins(repoRoot),
  ...checkNoAggregateConfectEntrypoints(repoRoot),
  ...checkNoEffectBarrelImports(repoRoot),
  ...checkLazySpecSchemas(repoRoot),
  ...checkImplsUseDatabaseSchema(repoRoot),
  ...checkTableShape(repoRoot),
];

export const runConfectV9Check = (repoRoot = process.cwd()): void => {
  const findings = collectConfectV9Findings(repoRoot);
  if (findings.length === 0) {
    console.log("check:confect-v9 ok");
    return;
  }

  for (const finding of findings) {
    console.error(`${finding.file}: ${finding.message}`);
  }
  process.exitCode = 1;
};

if (isDirectRun(import.meta.url)) runConfectV9Check();
