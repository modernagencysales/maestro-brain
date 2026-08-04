#!/usr/bin/env node
import { runTemplateApiOperation } from "@maestro-template/workflow-tooling";
import { createCliHandlers } from "./commands";
import { parseNamedArgs } from "./namedArgs";
import { cliFailure, formatJsonOutput } from "./result";
import { decodeCliRuntimeConfig, emptyCliRuntimeConfig } from "./runtimeConfig";
import { dispatchCliCommand } from "./router";
import type {
  CliCapabilityRequest,
  CliResult,
  CliRuntimeConfig,
} from "./types";

export { decodeCliRuntimeConfig };
export type { CliResult, CliRuntimeConfig };

export const staticCliOperationRefs: Readonly<Record<string, string>> = {};

export const staticCliCapabilityIds: ReadonlySet<string> = new Set(
  Object.keys(staticCliOperationRefs),
);

const remoteBrainOperationIds = new Set([
  "brain.context.get",
  "brain.answers.ask",
  "brain.sources.search",
  "brain.sources.get",
]);

const tenantSelectorNames = new Set([
  "organizationId",
  "organizationKey",
  "agencyKey",
  "workspaceId",
  "workspaceKey",
  "workspaceSlug",
  "brainId",
  "brainKey",
  "userId",
  "memberId",
  "keyId",
  "apiKeyId",
  "_id",
  "id",
]);

const containsTenantSelector = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsTenantSelector);

  return Object.entries(value).some(
    ([name, nested]) =>
      tenantSelectorNames.has(name) || containsTenantSelector(nested),
  );
};

const brainApiOrigin = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;

  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" && url.hostname.toLowerCase() === "localhost";
    return (url.protocol === "https:" || localHttp) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
};

const remoteBrainApiResult = async (
  argv: readonly string[],
  config: CliRuntimeConfig,
): Promise<CliResult> => {
  const operationId = argv[2] ?? "";
  if (!remoteBrainOperationIds.has(operationId)) {
    return cliFailure(`Unknown remote Brain operation: ${operationId}\n`);
  }

  const parsed = parseNamedArgs(argv.slice(3));
  if (!parsed.ok) return cliFailure(`${parsed.message}\n`);
  if (
    parsed.args.input === undefined ||
    Object.keys(parsed.args).some((name) => name !== "input")
  ) {
    return cliFailure("api call requires only --input.\n");
  }
  if (containsTenantSelector(parsed.args.input)) {
    return cliFailure(
      "Brain scope must be derived from MAESTRO_BRAIN_API_KEY.\n",
    );
  }

  const origin = brainApiOrigin(config.brainSiteUrl);
  if (origin === undefined) {
    return cliFailure(
      "CONVEX_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.\n",
    );
  }
  if (!config.brainApiKey) {
    return cliFailure("MAESTRO_BRAIN_API_KEY is required.\n");
  }

  try {
    const response = await fetch(`${origin}/api/${operationId}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.brainApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: parsed.args.input }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json();
    if (
      body === null ||
      typeof body !== "object" ||
      !("ok" in body) ||
      typeof body.ok !== "boolean"
    ) {
      return cliFailure("Brain API returned an invalid response.\n");
    }

    return {
      exitCode: response.ok && body.ok ? 0 : 1,
      stdout: formatJsonOutput(body)
        .split(config.brainApiKey)
        .join("[REDACTED]"),
      stderr: "",
    };
  } catch {
    return cliFailure("Brain API request failed.\n");
  }
};

const runStaticCliCapability = (
  capabilityId: string,
  request: CliCapabilityRequest,
): CliResult => {
  const operationId = staticCliOperationRefs[capabilityId];
  if (!staticCliCapabilityIds.has(capabilityId) || operationId === undefined) {
    return cliFailure(`Unknown CLI capability: ${capabilityId}\n`);
  }

  const result = runTemplateApiOperation(operationId, request);

  return {
    exitCode: result.ok ? 0 : 1,
    stdout: formatJsonOutput(result),
    stderr: "",
  };
};

const cliHandlers = createCliHandlers({
  capability: {
    hasCapability: (capabilityId) => staticCliCapabilityIds.has(capabilityId),
    runCapability: runStaticCliCapability,
  },
});

export const runCli = (
  argv: readonly string[],
  config: CliRuntimeConfig = emptyCliRuntimeConfig,
): CliResult => dispatchCliCommand(cliHandlers, argv, config);

export const runCliAsync = async (
  argv: readonly string[],
  config: CliRuntimeConfig = emptyCliRuntimeConfig,
): Promise<CliResult> =>
  argv[0] === "api" && argv[1] === "call"
    ? await remoteBrainApiResult(argv, config)
    : runCli(argv, config);

if (
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js")
) {
  void runCliAsync(
    process.argv.slice(2),
    decodeCliRuntimeConfig(process.env),
  ).then((result) => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  });
}
