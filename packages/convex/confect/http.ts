import { buildOpenApiDocument } from "@maestro-template/workflow-tooling";

export type TemplateHttpRoute = {
  readonly path: "/api/openapi.json" | "/api/docs";
  readonly method: "GET";
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

export const handleTemplateHttpRequest = (request: Request): Response => {
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return jsonResponse({
      ok: false,
      error: {
        _tag: "MethodNotAllowed",
        message: "Only GET is supported for template API docs routes.",
      },
    });
  }

  if (url.pathname === "/api/openapi.json") {
    return jsonResponse(buildOpenApiDocument());
  }

  if (url.pathname === "/api/docs") {
    return htmlResponse(scalarDocsHtml());
  }

  return jsonResponse({
    ok: false,
    error: {
      _tag: "NotFound",
      message: `Unknown template HTTP route: ${url.pathname}`,
    },
  });
};
