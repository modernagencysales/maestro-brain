import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import { httpActionGeneric, httpRouter } from "convex/server";
import { buildGeneratedOpenApiDocument } from "./manifest/openapi";
import { reviewedHeadlessPolicyFor } from "./headless/authorizeOperation";
import { mcpRouteResponse } from "./httpMcp";
import { executeTemplateApiRoute } from "./httpOperations";
import { htmlResponse, jsonResponse } from "./httpResponses";
import type { HeadlessHttpCtx, TemplateHttpRoute } from "./httpTypes";

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
  | { readonly kind: "operation"; readonly operationId: string }
  | { readonly kind: "notFound"; readonly pathname: string };

const staticTemplateRoutes: Record<string, TemplateRouteMatch | undefined> = {
  "/api/openapi.json": { kind: "openapi" },
  "/api/docs": { kind: "docs" },
  "/mcp": { kind: "mcp" },
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
