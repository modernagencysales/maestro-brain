import { access, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { descriptorFor } from "./src/check-definitions.mts";
import { isDirectRun } from "./src/direct-run.mts";
import { runStaticCheck } from "./src/gate.mts";

export const descriptor = descriptorFor("confect-contracts");

export type ConfectContractFinding = {
  readonly file: string;
  readonly message: string;
};

const requiredGeneratedFiles = [
  "packages/convex/confect/_generated/refs.ts",
  "packages/convex/confect/_generated/spec.ts",
  "packages/template-core/src/generated/confectManifest.ts",
] as const;

const publicSpecConstructors = [
  "publicQuery",
  "publicMutation",
  "publicAction",
  "publicNodeAction",
] as const;

const publicSpecConstructorNames = new Set<string>(publicSpecConstructors);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(root: string, dir: string): Promise<string[]> {
  const fullDir = join(root, dir);
  if (!(await exists(fullDir))) return [];

  const files: string[] = [];
  const entries = await readdir(fullDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(fullDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(root, relative(root, entryPath))));
    } else if (entry.isFile()) {
      files.push(relative(root, entryPath));
    }
  }

  return files;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function isPublicFunctionSpecCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;

  return (
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "FunctionSpec" &&
    publicSpecConstructorNames.has(node.expression.name.text)
  );
}

function hasTopLevelErrorProperty(input: ts.ObjectLiteralExpression): boolean {
  return input.properties.some((property) => {
    if (
      ts.isPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isShorthandPropertyAssignment(property)
    ) {
      return propertyNameText(property.name) === "error";
    }

    return false;
  });
}

export function publicSpecMissingError(source: string): string | undefined {
  const sourceFile = ts.createSourceFile(
    "confect-spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let missingConstructor: string | undefined;

  const visit = (node: ts.Node): void => {
    if (missingConstructor !== undefined) return;

    if (ts.isCallExpression(node) && isPublicFunctionSpecCall(node)) {
      const constructor = (node.expression as ts.PropertyAccessExpression).name
        .text;
      const input = node.arguments[0]
        ? unwrapExpression(node.arguments[0])
        : undefined;

      if (input !== undefined && ts.isObjectLiteralExpression(input)) {
        if (!hasTopLevelErrorProperty(input)) {
          missingConstructor = constructor;
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (missingConstructor !== undefined) {
    return `Public Confect ${missingConstructor} must declare a typed error with \`error:\`.`;
  }

  return undefined;
}

export function ambientDateNow(source: string): string | undefined {
  return /\bDate\s*\.\s*now\s*\(/.test(source)
    ? "Confect impls must not use ambient Date.now(); inject or derive time from typed inputs."
    : undefined;
}

const stablePageOperationIds = [
  "brain.pages.list",
  "brain.pages.get",
  "brain.pages.create",
  "brain.pages.rename",
  "brain.pages.move",
  "brain.pages.favorite",
  "brain.pages.archive",
] as const;

export function brainPagesStableContract(source: string): string | undefined {
  if (!source.includes("BrainKey")) return undefined;
  const required = [
    "BrainNotFound",
    "PageNotFound",
    "operationId: `brain.pages.${name}`",
    ...stablePageOperationIds,
  ];
  const missing = required.filter((marker) => !source.includes(marker));
  if (source.includes("createMarkdown")) missing.push("no createMarkdown");
  return missing.length === 0
    ? undefined
    : `Stable Brain page contract is missing: ${missing.join(", ")}.`;
}

export function plainConvexValueImports(source: string): string | undefined {
  const importPattern =
    /import\s+(?!type\b)([\s\S]*?)\s+from\s+["']convex\/[^"']+["']/g;

  for (const match of source.matchAll(importPattern)) {
    const importClause = match[1].trim();
    const namedImport = importClause.match(/\{([\s\S]*?)\}/);
    if (!namedImport) {
      return "Confect specs must keep convex/* imports type-only for plain Convex component functions.";
    }

    const valueImports = namedImport[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !part.startsWith("type "));

    if (valueImports.length > 0) {
      return "Confect specs must keep convex/* imports type-only for plain Convex component functions.";
    }
  }

  return undefined;
}

export function requiredGeneratedFilesMissing(
  files: ReadonlySet<string>,
): readonly string[] {
  return requiredGeneratedFiles
    .filter((file) => !files.has(file))
    .map((file) => `${file}: required generated Confect file is missing.`);
}

export async function collectConfectContractFindings(
  repoRoot = process.cwd(),
): Promise<readonly ConfectContractFinding[]> {
  const findings: ConfectContractFinding[] = [];
  const allFiles = await walk(repoRoot, "packages/convex/confect");
  const knownFiles = new Set(
    [
      ...allFiles,
      ...(await Promise.all(
        requiredGeneratedFiles.map(async (file) =>
          (await exists(join(repoRoot, file))) ? file : undefined,
        ),
      )),
    ].filter((file): file is string => file !== undefined),
  );

  for (const message of requiredGeneratedFilesMissing(knownFiles)) {
    const [file] = message.split(":");
    findings.push({ file, message });
  }

  for (const file of allFiles.filter((path) => path.endsWith(".spec.ts"))) {
    const source = await readFile(join(repoRoot, file), "utf8");
    const importMessage = plainConvexValueImports(source);
    const errorMessage = publicSpecMissingError(source);

    if (importMessage) findings.push({ file, message: importMessage });
    if (errorMessage) findings.push({ file, message: errorMessage });
    if (file === "packages/convex/confect/brain/pages.spec.ts") {
      const pageMessage = brainPagesStableContract(source);
      if (pageMessage) findings.push({ file, message: pageMessage });
    }
  }

  for (const file of allFiles.filter((path) => path.endsWith(".impl.ts"))) {
    const source = await readFile(join(repoRoot, file), "utf8");
    const message = ambientDateNow(source);
    if (message) findings.push({ file, message });
  }

  return findings;
}

export async function runConfectContractCheck(
  repoRoot = process.cwd(),
): Promise<void> {
  await runStaticCheck(descriptor, repoRoot);

  if (process.exitCode !== undefined && process.exitCode !== 0) return;

  const findings = await collectConfectContractFindings(repoRoot);
  if (findings.length === 0) {
    console.log(`${descriptor.name}: ok (semantic)`);
    return;
  }

  for (const finding of findings) {
    console.error(`${descriptor.name}: ${finding.file}: ${finding.message}`);
  }
  process.exitCode = 1;
}

if (isDirectRun(import.meta.url)) await runConfectContractCheck();
