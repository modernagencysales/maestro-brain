import {
  buildApiCatalog,
  buildOpenApiDocument,
  runTemplateApiOperation,
  type TemplateApiRequest,
} from "@maestro-template/workflow-tooling";

export type TemplateHttpRoute = {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly description: string;
};

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
  ...buildApiCatalog().map((entry) => ({
    path: entry.path,
    method: entry.method,
    description: `Executes ${entry.operationId} through the shared template registry.`,
  })),
] as const satisfies readonly TemplateHttpRoute[];

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value, null, 2), {
    headers: {
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
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const readJsonBody = async (request: Request): Promise<TemplateApiRequest> => {
  if (!request.body) {
    return {};
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {};
  }

  const value = (await request.json()) as unknown;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as TemplateApiRequest;
};

export const handleTemplateHttpRequest = async (
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === "/api/openapi.json") {
    if (request.method !== "GET") {
      return jsonResponse({
        ok: false,
        error: {
          _tag: "MethodNotAllowed",
          message: "Only GET is supported for OpenAPI docs.",
        },
      });
    }

    return jsonResponse(buildOpenApiDocument());
  }

  if (url.pathname === "/api/docs") {
    if (request.method !== "GET") {
      return jsonResponse({
        ok: false,
        error: {
          _tag: "MethodNotAllowed",
          message: "Only GET is supported for Scalar docs.",
        },
      });
    }

    return htmlResponse(scalarDocsHtml());
  }

  const apiEntry = buildApiCatalog().find(
    (entry) => entry.path === url.pathname,
  );

  if (apiEntry) {
    if (request.method !== apiEntry.method) {
      return jsonResponse({
        ok: false,
        error: {
          _tag: "MethodNotAllowed",
          message: `Only ${apiEntry.method} is supported for ${apiEntry.path}.`,
        },
      });
    }

    return jsonResponse(
      runTemplateApiOperation(
        apiEntry.operationId,
        await readJsonBody(request),
      ),
    );
  }

  return jsonResponse({
    ok: false,
    error: {
      _tag: "NotFound",
      message: `Unknown template HTTP route: ${url.pathname}`,
    },
  });
};
