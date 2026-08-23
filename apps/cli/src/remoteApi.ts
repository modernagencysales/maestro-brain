import { parseNamedArgs } from "./namedArgs";
import { brainApiOrigin, containsTenantSelector } from "./remoteSafety";
import { cliFailure, formatJsonOutput } from "./result";
import type { CliResult, CliRuntimeConfig } from "./types";

export const remoteCliOperationRefs: Readonly<Record<string, string>> = {
  "brain.context.get": "brain.context.get",
  "brain.answers.ask": "brain.answers.ask",
  "brain.sources.search": "brain.sources.search",
  "brain.sources.get": "brain.sources.get",
  "brain.rollout.status": "brain.rollout.status",
  "brain.feedback.reportWrongOrStale": "brain.feedback.reportWrongOrStale",
  "brain.notes.submit": "brain.notes.submit",
  "brain.notes.status": "brain.notes.status",
  "brain.notes.list": "brain.notes.list",
};

export type RemoteBrainRequest = {
  readonly operationId: string;
  readonly input: Record<string, unknown>;
  readonly idempotencyKey?: string;
};

const operationError = (request: RemoteBrainRequest): string | undefined =>
  remoteCliOperationRefs[request.operationId] === undefined
    ? `Unknown remote Brain operation: ${request.operationId}\n`
    : undefined;

const selectorError = (request: RemoteBrainRequest): string | undefined =>
  containsTenantSelector(request.input)
    ? "Brain scope must be derived from MAESTRO_BRAIN_API_KEY.\n"
    : undefined;

const originError = (
  configured: string | undefined,
  origin: string | undefined,
): string | undefined => {
  if (!configured) return "CONVEX_SITE_URL is required.\n";
  return origin === undefined
    ? "CONVEX_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.\n"
    : undefined;
};

const apiKeyError = (apiKey: string | undefined): string | undefined =>
  !apiKey || apiKey.trim() !== apiKey
    ? "MAESTRO_BRAIN_API_KEY is required.\n"
    : undefined;

export const remoteBrainConfigError = (
  config: CliRuntimeConfig,
): string | undefined => {
  const origin = brainApiOrigin(config.brainSiteUrl);
  return (
    originError(config.brainSiteUrl, origin) ?? apiKeyError(config.brainApiKey)
  );
};

const validatedRemoteTarget = (
  request: RemoteBrainRequest,
  config: CliRuntimeConfig,
): { readonly origin: string; readonly apiKey: string } | CliResult => {
  const origin = brainApiOrigin(config.brainSiteUrl);
  const apiKey = config.brainApiKey;
  const error = [
    operationError(request),
    selectorError(request),
    remoteBrainConfigError(config),
  ].find((message): message is string => message !== undefined);
  return error === undefined
    ? { origin: origin as string, apiKey: apiKey as string }
    : cliFailure(error);
};

const isCliResult = (
  value: CliResult | { readonly origin: string; readonly apiKey: string },
): value is CliResult => "exitCode" in value;

const parsedApiResponse = async (
  response: Response,
  apiKey: string,
): Promise<CliResult> => {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    return cliFailure(
      `Brain API returned HTTP ${response.status} with a non-JSON response.\n`,
    );
  }
  if (
    body === null ||
    typeof body !== "object" ||
    !("ok" in body) ||
    typeof body.ok !== "boolean"
  )
    return cliFailure(
      `Brain API returned HTTP ${response.status} with an invalid response.\n`,
    );
  return {
    exitCode: response.ok && body.ok ? 0 : 1,
    stdout: formatJsonOutput(body).split(apiKey).join("[REDACTED]"),
    stderr: "",
  };
};

export const executeRemoteBrainRequest = async (
  request: RemoteBrainRequest,
  config: CliRuntimeConfig,
): Promise<CliResult> => {
  const target = validatedRemoteTarget(request, config);
  if (isCliResult(target)) return target;
  try {
    const response = await fetch(
      `${target.origin}/api/${remoteCliOperationRefs[request.operationId]}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${target.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: request.input,
          ...(request.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.idempotencyKey }),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    return await parsedApiResponse(response, target.apiKey);
  } catch {
    return cliFailure(
      "Could not reach Brain API (network error or timeout).\n",
    );
  }
};

export const remoteBrainApiResult = async (
  argv: readonly string[],
  config: CliRuntimeConfig,
): Promise<CliResult> => {
  const parsed = parseNamedArgs(argv.slice(3));
  if (!parsed.ok) return cliFailure(`${parsed.message}\n`);
  const { input, idempotencyKey, ...unsupported } = parsed.args;
  if (input === undefined || Object.keys(unsupported).length > 0)
    return cliFailure(
      "api call requires --input and optionally --idempotency-key.\n",
    );
  return await executeRemoteBrainRequest(
    {
      operationId: argv[2] ?? "",
      input,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    },
    config,
  );
};
