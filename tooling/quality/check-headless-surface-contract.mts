import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { confectManifest } from "../../packages/template-core/src/generated/confectManifest";
import { descriptorFor } from "./src/check-definitions.mts";
import { isDirectRun } from "./src/direct-run.mts";
import { evaluateStaticCheck } from "./src/gate.mts";

export const descriptor = descriptorFor("headless-surface-contract");

const externalSurfaces = ["api", "cli", "mcp"] as const;
type ExternalSurface = (typeof externalSurfaces)[number];

const clientCallableSurfaces = ["web", ...externalSurfaces] as const;
type ClientCallableSurface = (typeof clientCallableSurfaces)[number];

type Surface = ExternalSurface | "web" | "workflow" | "internal" | string;

const servicePrincipalHttpRefs: Readonly<Record<string, string>> = {
  "brain.sources.search": "internal.brain.readApi.headlessSourcesSearch",
  "brain.sources.get": "internal.brain.readApi.headlessSourcesGet",
  "brain.context.get": "internal.brain.readApi.headlessContextGet",
  "brain.answers.ask": "internal.brain.readApi.headlessAnswersAsk",
  "brain.rollout.status": "internal.brain.readApi.headlessBrainRolloutStatus",
};

export type HeadlessManifestOperation = {
  readonly operationId: string;
  readonly namespace?: string;
  readonly name?: string;
  readonly surfaces: readonly Surface[];
  readonly typedErrors: readonly string[];
  readonly kind?: string;
  readonly idempotent?: boolean;
};

export const httpGeneratedRefMappings = (
  operations: readonly HeadlessManifestOperation[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    operations.flatMap((operation) =>
      operation.namespace === undefined || operation.name === undefined
        ? []
        : [
            [
              operation.operationId,
              servicePrincipalHttpRefs[operation.operationId] ??
                `api.${operation.namespace}.${operation.name}`,
            ],
          ],
    ),
  );

const hasExternalSurface = (operation: HeadlessManifestOperation): boolean =>
  operation.surfaces.some((surface) =>
    externalSurfaces.includes(surface as ExternalSurface),
  );

const exposedOperationIds = (
  operations: readonly HeadlessManifestOperation[],
  surface: ExternalSurface,
): string[] =>
  operations
    .filter((operation) => operation.surfaces.includes(surface))
    .map((operation) => operation.operationId);

export const missingTypedErrors = (
  operations: readonly HeadlessManifestOperation[],
): string[] =>
  operations
    .filter(
      (operation) =>
        hasExternalSurface(operation) && operation.typedErrors.length === 0,
    )
    .map((operation) => operation.operationId);

export const missingExternalValidationError = (
  operations: readonly HeadlessManifestOperation[],
): string[] =>
  operations
    .filter(
      (operation) =>
        hasExternalSurface(operation) &&
        !operation.typedErrors.includes("ValidationFailed"),
    )
    .map((operation) => operation.operationId);

const hasClientCallableSurface = (
  operation: HeadlessManifestOperation,
): boolean =>
  operation.surfaces.some((surface) =>
    clientCallableSurfaces.includes(surface as ClientCallableSurface),
  );

const isInternalNamedOperation = (
  operation: HeadlessManifestOperation,
): boolean => {
  const operationName = operation.operationId.split(".").at(-1) ?? "";
  return operationName.endsWith("Internal");
};

export const internalNamedOperationsWithClientSurfaces = (
  operations: readonly HeadlessManifestOperation[],
): string[] =>
  operations
    .filter(
      (operation) =>
        isInternalNamedOperation(operation) &&
        hasClientCallableSurface(operation),
    )
    .map((operation) => operation.operationId);

export const cannedRegistryImport = (source: string): string[] => {
  const forbiddenImport =
    /import\s*\{[^}]*\btemplateRegistry\b[^}]*\}\s*from\s*["']@maestro-template\/template-core["']/m;
  return forbiddenImport.test(source) ? ["templateRegistry"] : [];
};

type RuntimeSource = {
  readonly path: string;
  readonly source: string;
};

export const cannedRegistryImportFailures = (
  sources: readonly RuntimeSource[],
): string[] =>
  sources.flatMap(({ path, source }) =>
    cannedRegistryImport(source).map(
      (marker) => `${path} imports forbidden canned registry ${marker}`,
    ),
  );

export const cannedRuntimeSuccess = (source: string): string[] => {
  const markers = [
    /\baccepted\s*:\s*true\b/,
    /\bok\s*:\s*true\s*,\s*result\s*:\s*\{[^}]*\}/s,
  ] as const;

  return markers.some((marker) => marker.test(source)) ? ["accepted"] : [];
};

const missingLiteralGeneratedRefMapping = (
  operationIds: readonly string[],
  source: string,
): string[] =>
  operationIds.filter(
    (operationId) =>
      !source.includes(`"${operationId}"`) &&
      !source.includes(`'${operationId}'`) &&
      !source.includes(`\`${operationId}\``),
  );

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const objectMappingPattern = (
  objectName: string,
  operationId: string,
  mappedValue: string,
): RegExp =>
  new RegExp(
    `\\b${objectName}\\b[\\s\\S]*?["'\`]${escapeRegExp(operationId)}["'\`]\\s*:\\s*${mappedValue}`,
  );

export const missingHttpGeneratedRefMapping = (
  operationIds: readonly string[],
  source: string,
  generatedRefs: Readonly<Record<string, string>> = {},
): string[] =>
  operationIds.filter((operationId) => {
    const generatedRef = generatedRefs[operationId] ?? `api.${operationId}`;
    return !objectMappingPattern(
      "operationRefs",
      operationId,
      `${escapeRegExp(generatedRef)}\\b`,
    ).test(source);
  });

export const missingCliGeneratedRefUsage = (
  operationIds: readonly string[],
  source: string,
): string[] => {
  const mappedOperationVariable = source.match(
    /\b(?:const|let)\s+([a-zA-Z_$][\w$]*)\s*=\s*staticCliOperationRefs\s*\[[^\]]+\]/,
  )?.[1];
  const usesGeneratedCliRefs =
    /\brunTemplateApiOperation\s*\(\s*staticCliOperationRefs\s*\[[^\]]+\]/.test(
      source,
    ) ||
    (mappedOperationVariable !== undefined &&
      new RegExp(
        `\\brunTemplateApiOperation\\s*\\(\\s*${mappedOperationVariable}\\b`,
      ).test(source));

  const remoteMappedOperationVariable = source.match(
    /\b(?:const|let)\s+([a-zA-Z_$][\w$]*)\s*=\s*remoteCliOperationRefs\s*\[[^\]]+\]/,
  )?.[1];
  const usesRemoteCliRefs =
    remoteMappedOperationVariable !== undefined &&
    new RegExp(
      `fetch\\s*\\(\\s*[^,]*\\/api\\/\\$\\{${remoteMappedOperationVariable}\\}`,
    ).test(source);

  return operationIds.filter(
    (operationId) =>
      !(
        (objectMappingPattern(
          "staticCliOperationRefs",
          operationId,
          `["'\`]${operationId.replaceAll(".", "\\.")}["'\`]`,
        ).test(source) &&
          usesGeneratedCliRefs) ||
        (objectMappingPattern(
          "remoteCliOperationRefs",
          operationId,
          `["'\`]${operationId.replaceAll(".", "\\.")}["'\`]`,
        ).test(source) &&
          usesRemoteCliRefs)
      ),
  );
};

export const missingMcpGeneratedRefUsage = (
  operationIds: readonly string[],
  source: string,
): string[] => {
  const usesGeneratedRefsForToolListing =
    /\bgeneratedMcpOperationRefs\s*\[\s*entry\.operationId\s*\]/.test(source);
  const usesGeneratedRefsForCallDispatch =
    /\bgeneratedMcpOperationRefs\s*\[\s*candidate\.operationId\s*\]\s*===\s*toolName/.test(
      source,
    );

  return operationIds.filter(
    (operationId) =>
      !objectMappingPattern(
        "generatedMcpOperationRefs",
        operationId,
        `["'\`]template\\.${operationId.replaceAll(".", "\\.")}["'\`]`,
      ).test(source) ||
      !usesGeneratedRefsForToolListing ||
      !usesGeneratedRefsForCallDispatch,
  );
};

export const missingHttpExecutorDispatch = (source: string): boolean =>
  !/\bexecuteHeadlessOperation\s*\(/.test(source) ||
  !/\brefs\s*:\s*(?:ctx\.operationRefs\s*\?\?\s*)?operationRefs\b/.test(source);

export const missingRuntimeAdapterDispatch = (source: string): boolean =>
  !/\bTemplateRuntimeAdapter\b/.test(source) ||
  !/\bruntime\.runGeneratedOperation\s*\(/.test(source);

type GeneratedRefProjection = "literal" | "http" | "cli" | "mcp";

export const missingGeneratedRefMapping = (
  operationIds: readonly string[],
  source: string,
  projection: GeneratedRefProjection = "literal",
): string[] => {
  if (projection === "http") {
    return missingHttpGeneratedRefMapping(operationIds, source);
  }
  if (projection === "cli") {
    return missingCliGeneratedRefUsage(operationIds, source);
  }
  if (projection === "mcp") {
    return missingMcpGeneratedRefUsage(operationIds, source);
  }
  return missingLiteralGeneratedRefMapping(operationIds, source);
};

const missingIdempotencyProof = (
  operations: readonly HeadlessManifestOperation[],
  source: string,
): string[] =>
  operations
    .filter(
      (operation) =>
        hasExternalSurface(operation) &&
        operation.idempotent === false &&
        ["mutation", "action"].includes(operation.kind ?? ""),
    )
    .filter(
      (operation) =>
        !source.includes(
          `Operation ${operation.operationId} requires a nonblank idempotencyKey.`,
        ),
    )
    .map((operation) => operation.operationId);

const readRepoFile = async (repoRoot: string, path: string): Promise<string> =>
  readFile(join(repoRoot, path), "utf8");

export const evaluateHeadlessSurfaceContract = async (
  repoRoot: string,
): Promise<readonly string[]> => {
  const staticResult = await evaluateStaticCheck(repoRoot, descriptor);
  const failures = [...staticResult.failures];
  const operations =
    confectManifest.functions as readonly HeadlessManifestOperation[];

  const [
    httpSource,
    cliSource,
    cliRemoteSource,
    workflowSource,
    workflowCompatSource,
    executorSource,
    httpTests,
    executorTests,
    workflowTests,
    confectGuide,
  ] = await Promise.all([
    readRepoFile(repoRoot, "packages/convex/confect/http.ts"),
    readRepoFile(repoRoot, "apps/cli/src/index.ts"),
    readRepoFile(repoRoot, "apps/cli/src/remoteApi.ts"),
    readRepoFile(repoRoot, "tooling/workflow/src/index.ts"),
    readRepoFile(repoRoot, "tooling/workflow/src/workflow-compat.ts"),
    readRepoFile(repoRoot, "packages/convex/confect/manifest/executor.ts"),
    readRepoFile(repoRoot, "packages/convex/test/http-docs.test.ts"),
    readRepoFile(repoRoot, "packages/convex/test/headless-executor.test.ts"),
    readRepoFile(repoRoot, "tooling/workflow/src/index.test.ts"),
    readRepoFile(repoRoot, "docs/template/confect-effect-guide.md"),
  ]);

  for (const operationId of missingTypedErrors(operations)) {
    failures.push(
      `operation ${operationId} is exposed to API/CLI/MCP without public typed errors`,
    );
  }

  for (const operationId of missingExternalValidationError(operations)) {
    failures.push(
      `operation ${operationId} is exposed to API/CLI/MCP without declaring ValidationFailed for envelope validation errors`,
    );
  }

  for (const operationId of internalNamedOperationsWithClientSurfaces(
    operations,
  )) {
    failures.push(
      `operation ${operationId} is internally named but exposed to a client-callable surface`,
    );
  }

  for (const operationId of missingIdempotencyProof(
    operations,
    [
      httpSource,
      executorSource,
      httpTests,
      executorTests,
      workflowTests,
      confectGuide,
    ].join("\n"),
  )) {
    failures.push(
      `operation ${operationId} is non-idempotent on API/CLI/MCP without idempotency-key enforcement proof`,
    );
  }

  const generatedHttpRefs = httpGeneratedRefMappings(operations);
  const apiMissingRefs = missingHttpGeneratedRefMapping(
    exposedOperationIds(operations, "api"),
    httpSource,
    generatedHttpRefs,
  );
  const cliMissingRefs = missingGeneratedRefMapping(
    exposedOperationIds(operations, "cli"),
    [cliSource, cliRemoteSource].join("\n"),
    "cli",
  );
  const mcpMissingRefs = missingGeneratedRefMapping(
    exposedOperationIds(operations, "mcp"),
    workflowSource,
    "mcp",
  );
  const runtimeSources = [
    { path: "packages/convex/confect/http.ts", source: httpSource },
    { path: "apps/cli/src/index.ts", source: cliSource },
    { path: "apps/cli/src/remoteApi.ts", source: cliRemoteSource },
    { path: "tooling/workflow/src/index.ts", source: workflowSource },
    {
      path: "tooling/workflow/src/workflow-compat.ts",
      source: workflowCompatSource,
    },
    {
      path: "packages/convex/confect/manifest/executor.ts",
      source: executorSource,
    },
  ] as const;

  for (const operationId of apiMissingRefs) {
    failures.push(
      `API operation ${operationId} lacks a generated ref mapping in packages/convex/confect/http.ts`,
    );
  }
  if (missingHttpExecutorDispatch(httpSource)) {
    failures.push(
      "API HTTP dispatch must execute generated operationRefs through executeHeadlessOperation",
    );
  }
  for (const operationId of cliMissingRefs) {
    failures.push(
      `CLI operation ${operationId} lacks a generated ref mapping in the CLI projection`,
    );
  }
  for (const operationId of mcpMissingRefs) {
    failures.push(
      `MCP operation ${operationId} lacks a generated ref mapping in the MCP projection`,
    );
  }
  if (missingRuntimeAdapterDispatch(workflowSource)) {
    failures.push(
      "CLI/MCP compatibility projection must dispatch through an explicit runtime adapter before returning FeatureDisabled",
    );
  }

  for (const marker of cannedRuntimeSuccess(
    runtimeSources.map(({ source }) => source).join("\n"),
  )) {
    failures.push(
      `runtime executor code returns canned success marker ${marker} instead of executeHeadlessOperation`,
    );
  }

  for (const failure of cannedRegistryImportFailures(runtimeSources)) {
    failures.push(failure);
  }

  if (httpSource.includes("@maestro-template/workflow-tooling")) {
    failures.push(
      "packages/convex/confect/http.ts must not import @maestro-template/workflow-tooling",
    );
  }

  return failures;
};

export const runHeadlessSurfaceContractCheck = async (
  repoRoot = process.cwd(),
): Promise<void> => {
  const failures = await evaluateHeadlessSurfaceContract(repoRoot);
  if (failures.length === 0) {
    console.log(`${descriptor.name}: ok`);
    return;
  }

  for (const failure of failures) {
    console.error(`${descriptor.name}: ${failure}`);
  }
  process.exitCode = 1;
};

if (isDirectRun(import.meta.url)) await runHeadlessSurfaceContractCheck();
