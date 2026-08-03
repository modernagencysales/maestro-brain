import { Ref } from "@confect/core";
import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import { httpActionGeneric, httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import {
  executeHeadlessOperation,
  type HeadlessExecutorRequest,
} from "./manifest/executor";
import { buildGeneratedOpenApiDocument } from "./manifest/openapi";
import { buildGeneratedMcpTools } from "./manifest/mcp";
import {
  authenticateBearerRequest,
  authenticatedExecutorRequestFor,
  authorizeOperationBeforeDecode,
  bearerKeyHashForRequest,
  readJsonBody,
  type TemplateApiRequestBody,
} from "./httpRequest";
import apiKeysSpec from "./headless/apiKeys.spec";
import pagesSpec from "./brain/pages.spec";
import readApiSpec from "./brain/readApi.spec";
import {
  reviewedHeadlessPolicyFor,
  type HeadlessOperationPolicy,
} from "./headless/authorizeOperation";
import type { HeadlessPrincipal } from "./headless/principal";

type ManifestFunction = (typeof confectManifest.functions)[number];

const hasSurface = (entry: ManifestFunction, surface: string): boolean =>
  (entry.surfaces as readonly string[]).includes(surface);

export type TemplateHttpRoute = {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly description: string;
};

export type RateLimitAdmissionMetadata = {
  readonly operationId: string;
  readonly pathname: string;
  readonly method: string;
  readonly hasAuthorization: boolean;
  readonly contentType: string | null;
  readonly userAgentFamily: "absent" | "present";
  readonly networkBucket: "direct" | "untrusted-forwarded";
};

export type HeadlessHttpCtx = {
  readonly runQuery: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runMutation: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runAction: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly authenticateRef?: unknown;
  readonly markLastUsedRef?: unknown;
  readonly operationRefs?: Record<string, unknown>;
  readonly operationPolicies?: Record<string, HeadlessOperationPolicy>;
  readonly rateLimit?: (
    input: RateLimitAdmissionMetadata,
  ) => boolean | Promise<boolean>;
};

type TemplateRouteMatch =
  | { readonly kind: "openapi" }
  | { readonly kind: "docs" }
  | { readonly kind: "mcp" }
  | { readonly kind: "operation"; readonly operationId: string }
  | { readonly kind: "notFound"; readonly pathname: string };

const staticTemplateRoutes: Record<string, TemplateRouteMatch | undefined> = {
  "/api/openapi.json": { kind: "openapi" },
  "/api/docs": { kind: "docs" },
  "/mcp": { kind: "mcp" },
};

const staticOperationRefs = {
  "brain.pages.list": Ref.getFunctionReference(
    Ref.make(
      "brain/pages",
      pagesSpec.functions.list as NonNullable<typeof pagesSpec.functions.list>,
    ),
  ),
  "brain.pages.get": Ref.getFunctionReference(
    Ref.make(
      "brain/pages",
      pagesSpec.functions.get as NonNullable<typeof pagesSpec.functions.get>,
    ),
  ),
  "brain.pages.history": Ref.getFunctionReference(
    Ref.make(
      "brain/pages",
      pagesSpec.functions.history as NonNullable<
        typeof pagesSpec.functions.history
      >,
    ),
  ),
  "brain.sources.search": Ref.getFunctionReference(
    Ref.make(
      "brain/readApi",
      readApiSpec.functions.sourcesSearch as NonNullable<
        typeof readApiSpec.functions.sourcesSearch
      >,
    ),
  ),
  "brain.sources.get": Ref.getFunctionReference(
    Ref.make(
      "brain/readApi",
      readApiSpec.functions.sourcesGet as NonNullable<
        typeof readApiSpec.functions.sourcesGet
      >,
    ),
  ),
  "brain.context.get": Ref.getFunctionReference(
    Ref.make(
      "brain/readApi",
      readApiSpec.functions.contextGet as NonNullable<
        typeof readApiSpec.functions.contextGet
      >,
    ),
  ),
  "brain.answers.ask": Ref.getFunctionReference(
    Ref.make(
      "brain/readApi",
      readApiSpec.functions.answersAsk as NonNullable<
        typeof readApiSpec.functions.answersAsk
      >,
    ),
  ),
} satisfies Record<string, unknown>;

const apiKeyFunction = (name: "authenticate" | "markLastUsed") => {
  const spec = apiKeysSpec.functions[name];
  if (spec === undefined) {
    throw new ConvexError({
      code: "HEADLESS_API_KEY_SPEC_MISSING",
      message: `Missing apiKeys.${name} spec`,
    });
  }
  return Ref.getFunctionReference(Ref.make("headless/apiKeys", spec));
};

const apiKeyRefs = {
  authenticate: apiKeyFunction("authenticate"),
  markLastUsed: apiKeyFunction("markLastUsed"),
} as const;

export const securityHeaders = {
  "content-security-policy":
    "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

export const templateHttpRoutes = [
  {
    path: "/api/openapi.json",
    method: "GET",
    description: "Serves the generated OpenAPI 3.1 document.",
  },
  {
    path: "/api/docs",
    method: "GET",
    description: "Serves the Scalar API documentation shell.",
  },
  {
    path: "/mcp",
    method: "POST",
    description: "Serves the stateless MCP tool transport.",
  },
  {
    path: "/api/*",
    method: "POST",
    description:
      "Returns the uniform headless error envelope for unknown API operations.",
  },
  ...confectManifest.functions
    .filter(
      (entry) =>
        hasSurface(entry, "api") &&
        (entry.operationId as string) !== "brain.pages.createMarkdown",
    )
    .map((entry) => ({
      path: `/api/${entry.operationId}`,
      method: "POST" as const,
      description: `Executes ${entry.operationId}.`,
    })),
] as const satisfies readonly TemplateHttpRoute[];

const withSecurityHeaders = (
  headers: HeadersInit = {},
): Record<string, string> => {
  const merged: Record<string, string> = { ...securityHeaders };
  new Headers(headers).forEach((value, key) => {
    merged[key] = value;
  });
  return merged;
};

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value, null, 2), {
    headers: {
      ...securityHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const scalarDocsHtml = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Maestro Template API Docs</title>
    <script id="api-reference" data-url="/api/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </head>
  <body>
    <noscript>OpenAPI JSON is available at /api/openapi.json.</noscript>
  </body>
</html>
`;

const htmlResponse = (html: string): Response =>
  new Response(html, {
    headers: withSecurityHeaders({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    }),
  });

const runTemplateApiOperation = async (
  ctx: HeadlessHttpCtx,
  request: HeadlessExecutorRequest,
): Promise<unknown> => {
  const operationRefs = ctx.operationRefs ?? staticOperationRefs;

  return await executeHeadlessOperation(
    {
      refs: operationRefs,
      runQuery: (ref, input) => ctx.runQuery(ref, input),
      runMutation: (ref, input) => ctx.runMutation(ref, input),
      runAction: (ref, input) => ctx.runAction(ref, input),
    },
    request,
  );
};

const templateRouteForPath = (pathname: string): TemplateRouteMatch => {
  const apiEntry = confectManifest.functions.find(
    (entry) =>
      hasSurface(entry, "api") &&
      (entry.operationId as string) !== "brain.pages.createMarkdown" &&
      `/api/${entry.operationId}` === pathname,
  );
  const route =
    staticTemplateRoutes[pathname] ??
    (apiEntry
      ? { kind: "operation", operationId: apiEntry.operationId }
      : { kind: "notFound", pathname });

  return route;
};

const templateRouteResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  route: TemplateRouteMatch,
): Promise<Response> => {
  let response: Response;

  switch (route.kind) {
    case "openapi":
      response = openApiRouteResponse(request);
      break;
    case "docs":
      response = docsRouteResponse(request);
      break;
    case "mcp":
      response = await mcpRouteResponse(ctx, request);
      break;
    case "operation":
      response = await operationRouteResponse(ctx, request, route.operationId);
      break;
    case "notFound":
      response = notFoundRouteResponse(request, route.pathname);
      break;
  }

  return response;
};

type McpRequest = {
  readonly jsonrpc: "2.0";
  readonly id?: string | number;
  readonly method: "initialize" | "tools/list" | "tools/call";
  readonly params?: {
    readonly name?: string;
    readonly arguments?: Record<string, unknown>;
  };
};

const mcpReply = (id: string | number | undefined, result: unknown): Response =>
  jsonResponse({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), result });

const mcpError = (
  id: string | number | undefined,
  code: number,
  message: string,
): Response =>
  jsonResponse({
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    error: { code, message },
  });

const mcpRouteResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
): Promise<Response> => {
  if (request.method !== "POST")
    return mcpError(undefined, -32600, "Only POST is supported for /mcp.");
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return mcpError(
      undefined,
      -32600,
      "Content-Type must be application/json.",
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return mcpError(undefined, -32700, "Request body must be valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return mcpError(undefined, -32600, "MCP request must be a JSON object.");

  const candidate = body as Partial<McpRequest>;
  const id = candidate.id;
  if (candidate.jsonrpc !== "2.0" || typeof candidate.method !== "string")
    return mcpError(id, -32600, "Invalid MCP request.");
  if (candidate.method === "initialize")
    return mcpReply(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "maestro-brain", version: "1.0.0" },
    });
  if (candidate.method === "tools/list")
    return mcpReply(id, { tools: buildGeneratedMcpTools() });
  if (candidate.method !== "tools/call")
    return mcpError(id, -32601, "Method not found.");

  const name = candidate.params?.name;
  const operationId =
    typeof name === "string" && name.startsWith("template.")
      ? name.slice("template.".length)
      : undefined;
  if (
    operationId === undefined ||
    reviewedHeadlessPolicyFor(operationId) === undefined
  )
    return mcpError(id, -32602, "Unknown or unavailable MCP tool.");

  const input = candidate.params?.arguments ?? {};
  const apiRequest = new Request(
    `${new URL(request.url).origin}/api/${operationId}`,
    {
      method: "POST",
      headers: {
        authorization: request.headers.get("authorization") ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({ input }),
    },
  );
  const executed = await executeTemplateApiRoute(ctx, apiRequest, operationId);
  const result = await executed.json();
  return executed.ok
    ? mcpReply(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
      })
    : mcpReply(id, {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(result) }],
      });
};

const filteredOpenApiDocument = (): ReturnType<
  typeof buildGeneratedOpenApiDocument
> => {
  const document = buildGeneratedOpenApiDocument();
  const allowed = new Set(
    confectManifest.functions
      .filter(
        (entry) => reviewedHeadlessPolicyFor(entry.operationId) !== undefined,
      )
      .map((entry) => `/api/${entry.operationId}`),
  );
  const paths = Object.fromEntries(
    Object.entries(document.paths).filter(([path]) => allowed.has(path)),
  );
  return { ...document, paths };
};

const openApiRouteResponse = (request: Request): Response =>
  request.method === "GET"
    ? jsonResponse(filteredOpenApiDocument())
    : jsonResponse({
        ok: false,
        error: {
          _tag: "MethodNotAllowed",
          message: "Only GET is supported for OpenAPI docs.",
        },
      });

const docsRouteResponse = (request: Request): Response =>
  request.method === "GET"
    ? htmlResponse(scalarDocsHtml())
    : jsonResponse({
        ok: false,
        error: {
          _tag: "MethodNotAllowed",
          message: "Only GET is supported for Scalar docs.",
        },
      });

const operationRouteResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: string,
): Promise<Response> => {
  const response =
    request.method === "POST"
      ? await executeTemplateApiRoute(ctx, request, operationId)
      : jsonResponse({
          ok: false,
          error: {
            _tag: "MethodNotAllowed",
            message: `Only POST is supported for /api/${operationId}.`,
          },
        });

  return response;
};

const canonicalContentType = (value: string | null): string | null =>
  value?.split(";", 1)[0]?.trim().toLowerCase() || null;

const rateLimitAdmissionMetadataFor = (
  request: Request,
  operationId: string,
): RateLimitAdmissionMetadata => {
  const headers = request.headers;
  return {
    operationId,
    pathname: new URL(request.url).pathname,
    method: request.method,
    hasAuthorization: headers.has("authorization"),
    contentType: canonicalContentType(headers.get("content-type")),
    userAgentFamily: headers.has("user-agent") ? "present" : "absent",
    networkBucket: headers.has("x-forwarded-for")
      ? "untrusted-forwarded"
      : "direct",
  };
};

const executeTemplateApiRoute = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: string,
): Promise<Response> => {
  const policy =
    ctx.operationPolicies?.[operationId] ??
    reviewedHeadlessPolicyFor(operationId);
  if (policy === undefined) {
    return jsonResponse({
      ok: false,
      error: { _tag: "Forbidden", message: "Forbidden." },
    });
  }

  const limited = await ctx.rateLimit?.(
    rateLimitAdmissionMetadataFor(request, operationId),
  );
  if (limited === true) {
    return jsonResponse({
      ok: false,
      error: { _tag: "RateLimited", message: "Rate limited." },
    });
  }

  const keyHash = await bearerKeyHashForRequest(
    request.headers.get("authorization") ?? undefined,
  );
  if (!keyHash.ok) return jsonResponse(keyHash);

  const authenticate = (hash: string) =>
    ctx.runQuery(ctx.authenticateRef ?? apiKeyRefs.authenticate, {
      keyHash: hash,
      requiredScope: policy.requiredScope,
    });
  const authenticated = await authenticateBearerRequest({
    keyHash: keyHash.keyHash,
    runAuthenticate: authenticate,
  });
  if (!authenticated.ok) return jsonResponse(authenticated);

  const preauthorized = authorizeOperationBeforeDecode({
    operationId,
    principal: authenticated.principal,
    policy,
  });
  if (!preauthorized.ok) return jsonResponse(preauthorized);

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return jsonResponse(parsedBody);

  const executed = await responseForParsedTemplateApiBody(
    ctx,
    operationId,
    authenticated.principal,
    parsedBody.body,
    policy,
  ).catch(() => ({
    ok: false as const,
    error: { _tag: "Forbidden" as const, message: "Forbidden." },
  }));
  if (!isHeadlessExecutionSuccess(executed)) return jsonResponse(executed);

  const reauthenticated = await authenticateBearerRequest({
    keyHash: authenticated.keyHash,
    runAuthenticate: authenticate,
  });
  if (!reauthenticated.ok) return jsonResponse(reauthenticated);
  if (!sameAuthenticatedPrincipal(authenticated, reauthenticated)) {
    return jsonResponse({
      ok: false,
      error: { _tag: "Unauthorized", message: "Unauthorized." },
    });
  }

  await scheduleLastUsedBestEffort(ctx, reauthenticated, authenticated.keyHash);

  return jsonResponse(executed);
};

const responseForParsedTemplateApiBody = async (
  ctx: HeadlessHttpCtx,
  operationId: string,
  principal: HeadlessPrincipal,
  body: TemplateApiRequestBody,
  policy: HeadlessOperationPolicy,
): Promise<unknown> => {
  const executorRequest = await authenticatedExecutorRequestFor({
    operationId,
    principal,
    body,
    policy,
  });
  return executorRequest.ok
    ? await runTemplateApiOperation(ctx, executorRequest.request)
    : executorRequest;
};

const sameAuthenticatedPrincipal = (
  initial: {
    readonly principal: HeadlessPrincipal;
    readonly keyHash: string;
    readonly keyId?: string;
  },
  after: {
    readonly principal: HeadlessPrincipal;
    readonly keyHash: string;
    readonly keyId?: string;
  },
): boolean =>
  initial.keyHash === after.keyHash &&
  (initial.keyId ?? initial.principal.keyId) ===
    (after.keyId ?? after.principal.keyId) &&
  initial.principal.organizationId === after.principal.organizationId &&
  initial.principal.workspaceId === after.principal.workspaceId &&
  initial.principal.brainKey === after.principal.brainKey &&
  initial.principal.roleCeiling === after.principal.roleCeiling &&
  initial.principal.keyId === after.principal.keyId &&
  initial.principal.principalId === after.principal.principalId &&
  JSON.stringify([...initial.principal.scopes].sort()) ===
    JSON.stringify([...after.principal.scopes].sort());

const isHeadlessExecutionSuccess = (
  value: unknown,
): value is {
  readonly ok: true;
  readonly operationId: string;
  readonly result: unknown;
} =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  (value as { readonly ok?: unknown }).ok === true;

const scheduleLastUsedBestEffort = async (
  ctx: HeadlessHttpCtx,
  authenticated: {
    readonly principal: HeadlessPrincipal;
    readonly keyId?: string;
  },
  keyHash: string,
): Promise<void> => {
  const principal = authenticated.principal;
  const args = {
    keyId: authenticated.keyId ?? principal.keyId,
    keyHash,
    principalId: principal.principalId,
    organizationId: principal.organizationId,
    workspaceId: principal.workspaceId,
    brainKey: principal.brainKey,
  };
  try {
    await ctx.runMutation(ctx.markLastUsedRef ?? apiKeyRefs.markLastUsed, args);
  } catch {
    // Best-effort last-used updates must not change the authorization result.
  }
};

const unavailableHeadlessOperationResponse = (): Response =>
  jsonResponse({
    ok: false,
    error: {
      _tag: "ValidationFailed",
      message: "Headless operation is not available.",
    },
  });

const notFoundRouteResponse = (request: Request, pathname: string): Response =>
  request.headers.has("authorization") || pathname.startsWith("/api/")
    ? unavailableHeadlessOperationResponse()
    : jsonResponse({
        ok: false,
        error: {
          _tag: "NotFound",
          message: `Unknown template HTTP route: ${pathname}`,
        },
      });

export const handleTemplateHttpRequest = async (
  ctx: HeadlessHttpCtx,
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);
  const response = await templateRouteResponse(
    ctx,
    request,
    templateRouteForPath(url.pathname),
  );

  return response;
};

/**
 * The deployable router. Convex requires convex/http's default export to be
 * an httpRouter, so every declared route is mounted onto one here; dispatch
 * (including the fail-closed 404) stays in handleTemplateHttpRequest above.
 */
const buildTemplateHttpRouter = () => {
  const router = httpRouter();
  const handler = httpActionGeneric(async (ctx, request) => {
    const headlessCtx: HeadlessHttpCtx = {
      runQuery: (ref, input) => ctx.runQuery(ref as never, input as never),
      runMutation: (ref, input) =>
        ctx.runMutation(ref as never, input as never),
      runAction: (ref, input) => ctx.runAction(ref as never, input as never),
    };

    return handleTemplateHttpRequest(headlessCtx, request);
  });
  for (const route of templateHttpRoutes) {
    if (route.path === "/api/*") {
      router.route({ pathPrefix: "/api/", method: route.method, handler });
    } else {
      router.route({ path: route.path, method: route.method, handler });
    }
  }
  return router;
};

export default buildTemplateHttpRouter();
