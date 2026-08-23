import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import {
  type NangoSlackWebhook,
  parseNangoSlackWebhook,
  verifyNangoWebhookSignature,
} from "@maestro-template/integrations/nango/webhook";
import {
  httpActionGeneric,
  httpRouter,
  makeFunctionReference,
} from "convex/server";
import { buildGeneratedOpenApiDocument } from "./manifest/openapi";
import { reviewedHeadlessPolicyFor } from "./headless/authorizeOperation";
import { mcpRouteResponse } from "./httpMcp";
import { executeTemplateApiRoute } from "./httpOperations";
import { htmlResponse, jsonResponse } from "./httpResponses";
import type { HeadlessHttpCtx, TemplateHttpRoute } from "./httpTypes";
import { readProcessEnv } from "./shared/env";
import { sha256Hex } from "./shared/sha256";

export { securityHeaders } from "./httpResponses";
export type {
  HeadlessHttpCtx,
  RateLimitAdmissionMetadata,
  TemplateHttpRoute,
} from "./httpTypes";

type ManifestFunction = (typeof confectManifest.functions)[number];

const hasSurface = (entry: ManifestFunction, surface: string): boolean =>
  (entry.surfaces as readonly string[]).includes(surface);

type TemplateRouteMatch =
  | { readonly kind: "openapi" }
  | { readonly kind: "docs" }
  | { readonly kind: "mcp" }
  | { readonly kind: "nangoWebhook" }
  | { readonly kind: "operation"; readonly operationId: string }
  | { readonly kind: "notFound"; readonly pathname: string };

const staticTemplateRoutes: Record<string, TemplateRouteMatch | undefined> = {
  "/api/openapi.json": { kind: "openapi" },
  "/api/docs": { kind: "docs" },
  "/mcp": { kind: "mcp" },
  "/webhooks/nango": { kind: "nangoWebhook" },
  "/api/brain.feedback.reportWrongOrStale": {
    kind: "operation",
    operationId: "brain.feedback.reportWrongOrStale",
  },
  "/api/brain.notes.submit": {
    kind: "operation",
    operationId: "brain.notes.submit",
  },
  "/api/brain.notes.status": {
    kind: "operation",
    operationId: "brain.notes.status",
  },
  "/api/brain.notes.list": {
    kind: "operation",
    operationId: "brain.notes.list",
  },
};

const feedbackOperationId = "brain.feedback.reportWrongOrStale";
const noteSubmitOperationId = "brain.notes.submit";
const noteStatusOperationId = "brain.notes.status";
const noteListOperationId = "brain.notes.list";

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
    path: "/webhooks/nango",
    method: "POST",
    description: "Receives verified provider webhooks forwarded by Nango.",
  },
  {
    path: "/api/*",
    method: "POST",
    description:
      "Returns the uniform headless error envelope for unknown API operations.",
  },
  {
    path: `/api/${feedbackOperationId}`,
    method: "POST",
    description: "Records immutable wrong-or-stale Brain feedback.",
  },
  {
    path: `/api/${noteSubmitOperationId}`,
    method: "POST",
    description: "Submits a terminal note to the Brain review queue.",
  },
  {
    path: `/api/${noteStatusOperationId}`,
    method: "POST",
    description: "Returns terminal note review status metadata.",
  },
  {
    path: `/api/${noteListOperationId}`,
    method: "POST",
    description: "Lists recent terminal note review metadata.",
  },
  ...confectManifest.functions
    .filter(
      (entry) =>
        hasSurface(entry, "api") &&
        (entry.operationId as string) !== "brain.pages.createMarkdown" &&
        (entry.operationId as string) !== feedbackOperationId,
    )
    .map((entry) => ({
      path: `/api/${entry.operationId}`,
      method: "POST" as const,
      description: `Executes ${entry.operationId}.`,
    })),
] as const satisfies readonly TemplateHttpRoute[];

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
      response = await mcpRouteResponse(ctx, request, executeTemplateApiRoute);
      break;
    case "nangoWebhook":
      response = await nangoWebhookRouteResponse(ctx, request);
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

const receiveNangoSlackWebhookRef = makeFunctionReference<
  "mutation",
  {
    connectionId: string;
    providerConfigKey: string;
    payload: unknown;
    deliveryDigest: string;
    signature: string;
    receivedAt: number;
  },
  unknown
>("slack/nangoWebhook:receiveNangoSlackWebhook");

type SignedNangoBody =
  Readonly<{ rawBody: string; signature: string }> | Response;

const signedNangoBody = async (request: Request): Promise<SignedNangoBody> => {
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000)
    return jsonResponse(
      { ok: false, error: { _tag: "PayloadTooLarge" } },
      { status: 413 },
    );
  const signature = request.headers.get("x-nango-hmac-sha256") ?? "";
  const signingKey = readProcessEnv().NANGO_WEBHOOK_SIGNING_KEY?.trim() ?? "";
  const verified = await verifyNangoWebhookSignature({
    rawBody,
    signingKey,
    signature,
  });
  return verified
    ? { rawBody, signature }
    : jsonResponse(
        { ok: false, error: { _tag: "Unauthorized" } },
        { status: 401 },
      );
};

const parseNangoBody = (rawBody: string): unknown | Response => {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return jsonResponse(
      { ok: false, error: { _tag: "ValidationFailed" } },
      { status: 400 },
    );
  }
};

const nangoWebhookKindResponse = (
  webhook: NangoSlackWebhook,
): Response | null => {
  switch (webhook.kind) {
    case "slack_forward":
      return null;
    case "ignored":
      return jsonResponse({ ok: true, outcome: "ignored" }, { status: 202 });
    case "unattributed_slack":
      return jsonResponse(
        { ok: false, error: { _tag: "ConnectionAttributionRequired" } },
        { status: 422 },
      );
    case "malformed":
      return jsonResponse(
        { ok: false, error: { _tag: "ValidationFailed" } },
        { status: 400 },
      );
  }
};

const nangoWebhookPostResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
): Promise<Response> => {
  const signedBody = await signedNangoBody(request);
  if (signedBody instanceof Response) return signedBody;
  const parsed = parseNangoBody(signedBody.rawBody);
  if (parsed instanceof Response) return parsed;
  const webhook = parseNangoSlackWebhook(parsed);
  const kindResponse = nangoWebhookKindResponse(webhook);
  if (kindResponse !== null) return kindResponse;
  const forward = (
    webhook as Extract<NangoSlackWebhook, { readonly kind: "slack_forward" }>
  ).forward;
  let response: Response;
  try {
    const result = await ctx.runMutation(receiveNangoSlackWebhookRef, {
      ...forward,
      deliveryDigest: sha256Hex(signedBody.rawBody),
      signature: signedBody.signature,
      receivedAt: Date.now(),
    });
    response = jsonResponse({ ok: true, result }, { status: 202 });
  } catch {
    response = jsonResponse(
      { ok: false, error: { _tag: "WebhookProcessingUnavailable" } },
      { status: 503 },
    );
  }
  return response;
};

const nangoWebhookRouteResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
): Promise<Response> => {
  const response =
    request.method === "POST"
      ? await nangoWebhookPostResponse(ctx, request)
      : jsonResponse(
          { ok: false, error: { _tag: "MethodNotAllowed" } },
          { status: 405 },
        );
  return response;
};

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
