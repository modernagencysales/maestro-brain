import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import {
  httpActionGeneric,
  httpRouter,
  makeFunctionReference,
} from "convex/server";
import { api } from "../convex/_generated/api";
import { verifyEmailUnsubscribeToken } from "./email/unsubscribeToken";
import { readEmailHttpEnv } from "./email/env";
import {
  normalizePostmarkEvent,
  verifyPostmarkBasicAuth,
} from "./email/postmarkWebhook";
import { handleDeployAuthorityHttpRequest } from "./deployAuthority/http";
import {
  executeHeadlessOperation,
  type HeadlessExecutorRequest,
} from "./manifest/executor";
import { buildGeneratedOpenApiDocument } from "./manifest/openapi";
import {
  executorRequestFor,
  readJsonBody,
  type TemplateApiRequestBody,
} from "./httpRequest";
import { handleMcpHttpRequest } from "./httpMcp";
import { parseBearerApiKey } from "./headless/auth";
import { sha256Base64Url } from "./shared/tokenCrypto";

type ManifestFunction = (typeof confectManifest.functions)[number];

const hasSurface = (entry: ManifestFunction, surface: string): boolean =>
  (entry.surfaces as readonly string[]).includes(surface);

export type TemplateHttpRoute = {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly description: string;
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
};

type TemplateRouteMatch =
  | { readonly kind: "openapi" }
  | { readonly kind: "docs" }
  | { readonly kind: "dodoWebhook" }
  | { readonly kind: "postmarkWebhook" }
  | { readonly kind: "emailUnsubscribe" }
  | { readonly kind: "mcp" }
  | { readonly kind: "operation"; readonly operationId: string }
  | { readonly kind: "notFound"; readonly pathname: string };

const staticTemplateRoutes: Record<string, TemplateRouteMatch | undefined> = {
  "/api/openapi.json": { kind: "openapi" },
  "/api/docs": { kind: "docs" },
  "/webhooks/dodo": { kind: "dodoWebhook" },
  "/webhooks/email/postmark": { kind: "postmarkWebhook" },
  "/email/unsubscribe": { kind: "emailUnsubscribe" },
  "/mcp": { kind: "mcp" },
  "/api/records.list": { kind: "operation", operationId: "records.list" },
  "/api/records.read": { kind: "operation", operationId: "records.read" },
  "/api/records.create": {
    kind: "operation",
    operationId: "records.create",
  },
  "/api/brain.ask": { kind: "operation", operationId: "brain.ask" },
  "/api/brain.knowledge.extract": {
    kind: "operation",
    operationId: "brain.knowledge.extract",
  },
  "/api/brain.evaluations.list": {
    kind: "operation",
    operationId: "brain.evaluations.list",
  },
  "/api/brain.evaluations.get": {
    kind: "operation",
    operationId: "brain.evaluations.get",
  },
  "/api/brain.evaluations.adjudicate": {
    kind: "operation",
    operationId: "brain.evaluations.adjudicate",
  },
  "/api/brain.evaluations.freezePreview": {
    kind: "operation",
    operationId: "brain.evaluations.freezePreview",
  },
  "/api/brain.evaluations.freezeApply": {
    kind: "operation",
    operationId: "brain.evaluations.freezeApply",
  },
  "/api/brain.evaluations.export": {
    kind: "operation",
    operationId: "brain.evaluations.export",
  },
};

const recordOperationIds = [
  "records.list",
  "records.read",
  "records.create",
] as const;
type RecordOperationId = (typeof recordOperationIds)[number];
const isRecordOperation = (
  operationId: string,
): operationId is RecordOperationId =>
  recordOperationIds.some((candidate) => candidate === operationId);

const brainPageOperationIds = [
  "brain.pages.list",
  "brain.pages.get",
  "brain.pages.createMarkdown",
  "brain.pages.updateMarkdown",
  "brain.pages.history",
] as const;
type BrainPageOperationId = (typeof brainPageOperationIds)[number];
const isBrainPageOperation = (
  operationId: string,
): operationId is BrainPageOperationId =>
  brainPageOperationIds.some((candidate) => candidate === operationId);

const assistantAnswerOperationId = "agents.assistant.answerQuestion" as const;
const brainAskOperationId = "brain.ask" as const;
const assistantSaveExampleOperationId =
  "agents.assistant.saveEvaluationExample" as const;
const brainKnowledgeExtractionOperationId = "brain.knowledge.extract" as const;
const workspaceListOperationId = "auth.workspaces.list" as const;

const brainEvaluationOperationIds = [
  "brain.evaluations.list",
  "brain.evaluations.get",
  "brain.evaluations.adjudicate",
  "brain.evaluations.freezePreview",
  "brain.evaluations.freezeApply",
  "brain.evaluations.export",
] as const;
type BrainEvaluationOperationId = (typeof brainEvaluationOperationIds)[number];
const isBrainEvaluationOperation = (
  operationId: string,
): operationId is BrainEvaluationOperationId =>
  brainEvaluationOperationIds.some((candidate) => candidate === operationId);
const brainEvaluationWriteOperations = new Set<BrainEvaluationOperationId>([
  "brain.evaluations.adjudicate",
  "brain.evaluations.freezeApply",
]);
const brainEvaluationActorRefs: Record<BrainEvaluationOperationId, unknown> = {
  "brain.evaluations.list": makeFunctionReference<"query">(
    "capabilities/manageBrainEvaluationExamples:listBrainEvaluationExamplesForActor",
  ),
  "brain.evaluations.get": makeFunctionReference<"query">(
    "capabilities/manageBrainEvaluationExamples:getBrainEvaluationExampleForActor",
  ),
  "brain.evaluations.adjudicate": makeFunctionReference<"mutation">(
    "capabilities/manageBrainEvaluationExamples:adjudicateBrainEvaluationExampleForActor",
  ),
  "brain.evaluations.freezePreview": makeFunctionReference<"query">(
    "capabilities/manageBrainEvaluationExamples:previewBrainEvaluationFreezeForActor",
  ),
  "brain.evaluations.freezeApply": makeFunctionReference<"mutation">(
    "capabilities/manageBrainEvaluationExamples:applyBrainEvaluationFreezeForActor",
  ),
  "brain.evaluations.export": makeFunctionReference<"query">(
    "capabilities/manageBrainEvaluationExamples:exportBrainEvaluationExamplesForActor",
  ),
};

const connectionOperationIds = [
  "integrations.connections.list",
  "integrations.connections.begin",
  "integrations.connections.complete",
  "integrations.connections.revoke",
] as const;
type ConnectionOperationId = (typeof connectionOperationIds)[number];
const isConnectionOperation = (
  operationId: string,
): operationId is ConnectionOperationId =>
  connectionOperationIds.some((candidate) => candidate === operationId);

const operationRefs = {
  "brain.ask": makeFunctionReference<"query">(
    "capabilities/askCompanyBrain:askCompanyBrain",
  ),
  "brain.knowledge.extract": makeFunctionReference<"mutation">(
    "capabilities/extractBrainKnowledgeCandidates:queueBrainKnowledgeExtraction",
  ),
  "agents.assistant.answerQuestion": api.agents.assistant.answerQuestion,
  "agents.assistant.saveEvaluationExample":
    api.agents.assistant.saveEvaluationExample,
  "auth.workspaces.list": api.auth.workspaces.list,
  "brain.pages.createMarkdown": api.brain.pages.createMarkdown,
  "brain.pages.get": api.brain.pages.get,
  "brain.pages.history": api.brain.pages.history,
  "brain.pages.list": api.brain.pages.list,
  "brain.pages.updateMarkdown": api.brain.pages.updateMarkdown,
  "integrations.connections.begin": api.integrations.connections.begin,
  "integrations.connections.complete": api.integrations.connections.complete,
  "integrations.connections.list": api.integrations.connections.list,
  "integrations.connections.revoke": api.integrations.connections.revoke,
  "ops.email.previewBroadcast": (
    api as unknown as {
      readonly ops: {
        readonly email: { readonly previewBroadcast: unknown };
      };
    }
  ).ops.email.previewBroadcast,
  "ops.email.dispatchBroadcast": (
    api as unknown as {
      readonly ops: {
        readonly email: { readonly dispatchBroadcast: unknown };
      };
    }
  ).ops.email.dispatchBroadcast,
} satisfies Record<string, unknown>;

const dodoWebhookActionRef = makeFunctionReference<
  "action",
  {
    readonly rawBody: string;
    readonly webhookId: string;
    readonly signature?: string;
    readonly signatureTimestamp?: string;
  },
  { readonly eventId: string; readonly status: "processed" | "duplicate" }
>("commerce/webhooks:applyDodo");

const postmarkEventMutationRef = makeFunctionReference<
  "mutation",
  {
    readonly fingerprint: string;
    readonly kind:
      | "delivery"
      | "hard_bounce"
      | "soft_bounce"
      | "spam_complaint"
      | "subscription_change"
      | "open"
      | "click";
    readonly recipient: string;
    readonly providerMessageId?: string;
  },
  { readonly status: "processed" | "duplicate"; readonly suppressed: boolean }
>("ops/email:processProviderEvent");

const unsubscribeMutationRef = makeFunctionReference<
  "mutation",
  { readonly subscriberId: string },
  unknown
>("ops/email:unsubscribe");

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
    path: "/webhooks/dodo",
    method: "POST",
    description: "Verifies and applies a Dodo payment webhook.",
  },
  {
    path: "/webhooks/email/postmark",
    method: "POST",
    description: "Authenticates and normalizes a Postmark delivery event.",
  },
  {
    path: "/email/unsubscribe",
    method: "GET",
    description: "Shows the email unsubscribe confirmation page.",
  },
  {
    path: "/email/unsubscribe",
    method: "POST",
    description: "Applies a signed one-click marketing unsubscribe.",
  },
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
    description: "Serves the hosted streamable HTTP MCP transport.",
  },
  ...[
    ...new Set([
      ...confectManifest.functions
        .filter((entry) => hasSurface(entry, "api"))
        .map(({ operationId }) => operationId),
      ...recordOperationIds,
      brainAskOperationId,
      brainKnowledgeExtractionOperationId,
      ...brainEvaluationOperationIds,
    ]),
  ].map((operationId) => ({
    path: `/api/${operationId}`,
    method: "POST" as const,
    description: `Executes ${operationId}.`,
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

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value, null, 2), {
    status,
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

const unsubscribeHtmlResponse = (html: string): Response =>
  new Response(html, {
    headers: withSecurityHeaders({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    }),
  });

const runTemplateApiOperation = async (
  ctx: HeadlessHttpCtx,
  request: HeadlessExecutorRequest,
): Promise<unknown> =>
  await executeHeadlessOperation(
    {
      refs: operationRefs,
      runQuery: (ref, input) => ctx.runQuery(ref, input),
      runMutation: (ref, input) => ctx.runMutation(ref, input),
      runAction: (ref, input) => ctx.runAction(ref, input),
    },
    request,
  );

const templateRouteForPath = (pathname: string): TemplateRouteMatch => {
  const apiEntry = confectManifest.functions.find(
    (entry) =>
      hasSurface(entry, "api") && `/api/${entry.operationId}` === pathname,
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
    case "dodoWebhook":
      response = await dodoWebhookRouteResponse(ctx, request);
      break;
    case "postmarkWebhook":
      response = await postmarkWebhookRouteResponse(ctx, request);
      break;
    case "emailUnsubscribe":
      response = await emailUnsubscribeRouteResponse(ctx, request);
      break;
    case "mcp":
      response = await handleMcpHttpRequest(ctx, request, jsonResponse);
      break;
    case "operation":
      response = await operationRouteResponse(ctx, request, route.operationId);
      break;
    case "notFound":
      response = notFoundRouteResponse(route.pathname);
      break;
  }

  return response;
};

const postmarkWebhookRouteResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
): Promise<Response> => {
  const emailEnv = readEmailHttpEnv();

  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "MethodNotAllowed",
          message: "Only POST is supported for /webhooks/email/postmark.",
        },
      },
      405,
    );
  }
  if (
    !verifyPostmarkBasicAuth({
      authorization: request.headers.get("authorization"),
      username: emailEnv.POSTMARK_WEBHOOK_USERNAME,
      password: emailEnv.POSTMARK_WEBHOOK_PASSWORD,
    })
  ) {
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "Unauthorized",
          message: "Webhook authentication failed.",
        },
      },
      401,
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "ValidationFailed",
          message: "Webhook JSON is invalid.",
        },
      },
      400,
    );
  }
  const event = await normalizePostmarkEvent(payload);
  if (event === null) {
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "ValidationFailed",
          message: "Webhook event is unsupported.",
        },
      },
      400,
    );
  }
  return jsonResponse(await ctx.runMutation(postmarkEventMutationRef, event));
};

const unsubscribePage = (token: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head>
<body><main><h1>Stop marketing emails?</h1><p>Transactional account and purchase emails will continue.</p><form method="post"><input type="hidden" name="token" value="${token.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"><button type="submit">Unsubscribe</button></form></main></body></html>`;

const emailUnsubscribeRouteResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "MethodNotAllowed",
          message: "Only GET and POST are supported for /email/unsubscribe.",
        },
      },
      405,
    );
  }
  const url = new URL(request.url);
  const formToken =
    request.method === "POST"
      ? new URLSearchParams(await request.text()).get("token")
      : null;
  const token = formToken ?? url.searchParams.get("token") ?? "";
  const secret = readEmailHttpEnv().EMAIL_UNSUBSCRIBE_SECRET;
  const verified = secret
    ? await verifyEmailUnsubscribeToken({ token, secret })
    : null;
  if (verified === null) {
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "ValidationFailed",
          message: "Unsubscribe link is invalid or expired.",
        },
      },
      400,
    );
  }
  if (request.method === "GET")
    return unsubscribeHtmlResponse(unsubscribePage(token));
  await ctx.runMutation(unsubscribeMutationRef, {
    subscriberId: verified.subscriberId,
  });
  return unsubscribeHtmlResponse(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unsubscribed</title></head><body><main><h1>You are unsubscribed.</h1><p>You will no longer receive marketing emails.</p></main></body></html>',
  );
};

const dodoWebhookRouteResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
): Promise<Response> => {
  if (request.method !== "POST")
    return jsonResponse({
      ok: false,
      error: {
        _tag: "MethodNotAllowed",
        message: "Only POST is supported for /webhooks/dodo.",
      },
    });

  const rawBody = await request.text();
  const result = await ctx.runAction(dodoWebhookActionRef, {
    rawBody,
    webhookId: request.headers.get("webhook-id") ?? "",
    signature: request.headers.get("webhook-signature") ?? "",
    signatureTimestamp: request.headers.get("webhook-timestamp") ?? "",
  });
  return jsonResponse(result);
};

const openApiRouteResponse = (request: Request): Response =>
  request.method === "GET"
    ? jsonResponse(buildGeneratedOpenApiDocument())
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

const executeTemplateApiRoute = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: string,
): Promise<Response> => {
  const parsedBody = await readJsonBody(request);
  const response = parsedBody.ok
    ? isRecordOperation(operationId)
      ? await recordsApiResponse(ctx, request, operationId, parsedBody.body)
      : isBrainPageOperation(operationId)
        ? await brainPagesApiResponse(
            ctx,
            request,
            operationId,
            parsedBody.body,
          )
        : isConnectionOperation(operationId)
          ? await connectionsApiResponse(
              ctx,
              request,
              operationId,
              parsedBody.body,
            )
          : operationId === workspaceListOperationId
            ? await workspaceListApiResponse(ctx, request, parsedBody.body)
            : operationId === brainAskOperationId
              ? await brainAskApiResponse(ctx, request, parsedBody.body)
              : operationId === assistantAnswerOperationId
                ? await assistantAnswerApiResponse(
                    ctx,
                    request,
                    parsedBody.body,
                  )
                : operationId === brainKnowledgeExtractionOperationId
                  ? await brainKnowledgeExtractionApiResponse(
                      ctx,
                      request,
                      parsedBody.body,
                    )
                  : operationId === assistantSaveExampleOperationId
                    ? await assistantSaveExampleApiResponse(
                        ctx,
                        request,
                        parsedBody.body,
                      )
                    : isBrainEvaluationOperation(operationId)
                      ? await brainEvaluationApiResponse(
                          ctx,
                          request,
                          operationId,
                          parsedBody.body,
                        )
                      : await responseForParsedTemplateApiBody(
                          ctx,
                          operationId,
                          parsedBody.body,
                        )
    : jsonResponse(parsedBody);

  return response;
};

type RecordsActorResolution =
  | {
      readonly ok: true;
      readonly keyId: string;
      readonly workspaceId: string;
      readonly userId: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

const resolveRecordsActorRef = makeFunctionReference<
  "query",
  {
    readonly keyHash: string;
    readonly workspaceSlug: string;
    readonly requiredScope: "workspace:read" | "workspace:write";
    readonly nowMs: number;
  },
  RecordsActorResolution
>("headless/apiKeys:resolve");

const recordActorRefs = {
  "records.list": makeFunctionReference<"query">(
    "records/records:listForActor",
  ),
  "records.read": makeFunctionReference<"query">(
    "records/records:readForActor",
  ),
  "records.create": makeFunctionReference<"mutation">(
    "records/records:createForActor",
  ),
} satisfies Record<RecordOperationId, unknown>;

const brainPageActorRefs = {
  "brain.pages.list": makeFunctionReference<"query">(
    "brain/pages:listForActor",
  ),
  "brain.pages.get": makeFunctionReference<"query">("brain/pages:getForActor"),
  "brain.pages.createMarkdown": makeFunctionReference<"mutation">(
    "brain/pages:createMarkdownForActor",
  ),
  "brain.pages.updateMarkdown": makeFunctionReference<"mutation">(
    "brain/pages:updateMarkdownForActor",
  ),
  "brain.pages.history": makeFunctionReference<"query">(
    "brain/pages:historyForActor",
  ),
} satisfies Record<BrainPageOperationId, unknown>;

const assistantAnswerForActorRef = makeFunctionReference<"query">(
  "agents/assistant:answerQuestionForActor",
);
const brainAskForActorRef = makeFunctionReference<"query">(
  "capabilities/askCompanyBrain:askCompanyBrainForActor",
);
const assistantSaveExampleForActorRef = makeFunctionReference<"mutation">(
  "agents/assistant:saveEvaluationExampleForActor",
);
const brainKnowledgeExtractionForActorRef = makeFunctionReference<"mutation">(
  "capabilities/extractBrainKnowledgeCandidates:queueBrainKnowledgeExtractionForActor",
);
const workspaceListForActorRef = makeFunctionReference<"query">(
  "auth/workspaces:listForActor",
);

const connectionActorRefs = {
  "integrations.connections.list": makeFunctionReference<"query">(
    "integrations/connections:listForActor",
  ),
  "integrations.connections.begin": makeFunctionReference<"mutation">(
    "integrations/connections:beginForActor",
  ),
  "integrations.connections.complete": makeFunctionReference<"mutation">(
    "integrations/connections:completeForActor",
  ),
  "integrations.connections.revoke": makeFunctionReference<"mutation">(
    "integrations/connections:revokeForActor",
  ),
} satisfies Record<ConnectionOperationId, unknown>;

const connectionWriteOperations = new Set<ConnectionOperationId>([
  "integrations.connections.begin",
  "integrations.connections.complete",
  "integrations.connections.revoke",
]);

const brainPageWriteOperations = new Set<BrainPageOperationId>([
  "brain.pages.createMarkdown",
  "brain.pages.updateMarkdown",
]);

const brainWorkspaceFailure = (
  workspaceSlug: string | undefined,
): Response | undefined =>
  workspaceSlug
    ? undefined
    : jsonResponse(
        {
          ok: false,
          error: {
            _tag: "ValidationFailed",
            message: "Brain operations require workspaceSlug.",
          },
        },
        400,
      );

const brainIdempotencyFailure = (
  operationId: BrainPageOperationId,
  idempotencyKey: string | undefined,
): Response | undefined =>
  brainPageWriteOperations.has(operationId) && !idempotencyKey
    ? jsonResponse(
        {
          ok: false,
          error: {
            _tag: "ValidationFailed",
            message: `Operation ${operationId} requires a nonblank idempotencyKey.`,
          },
        },
        400,
      )
    : undefined;

const brainActorFailure = (
  actor: Exclude<RecordsActorResolution, { readonly ok: true }>,
) => {
  const forbidden =
    actor.code === "API_KEY_FORBIDDEN" ||
    actor.code === "API_KEY_WORKSPACE_MISMATCH";
  return recordsAuthFailure(actor.code, actor.message, forbidden ? 403 : 401);
};

const admitBrainApiRequest = (
  request: Request,
  operationId: BrainPageOperationId,
  body: TemplateApiRequestBody,
):
  | {
      readonly ok: true;
      readonly presentedKey: string;
      readonly workspaceSlug: string;
    }
  | { readonly ok: false; readonly response: Response } => {
  const presentedKey = parseBearerApiKey(
    request.headers.get("authorization") ?? undefined,
  );
  if (typeof presentedKey !== "string") {
    return {
      ok: false,
      response: recordsAuthFailure(
        presentedKey.code,
        presentedKey.message,
        401,
      ),
    };
  }
  const workspaceSlug = body.workspaceSlug?.trim() ?? "";
  const failure =
    brainWorkspaceFailure(workspaceSlug) ??
    brainIdempotencyFailure(operationId, body.idempotencyKey?.trim());
  return failure
    ? { ok: false, response: failure }
    : { ok: true, presentedKey, workspaceSlug };
};

const admitAssistantApiRequest = (
  request: Request,
  body: TemplateApiRequestBody,
):
  | {
      readonly ok: true;
      readonly presentedKey: string;
      readonly workspaceSlug: string;
    }
  | { readonly ok: false; readonly response: Response } => {
  const presentedKey = parseBearerApiKey(
    request.headers.get("authorization") ?? undefined,
  );
  if (typeof presentedKey !== "string") {
    return {
      ok: false,
      response: recordsAuthFailure(
        presentedKey.code,
        presentedKey.message,
        401,
      ),
    };
  }
  const workspaceSlug = body.workspaceSlug?.trim() ?? "";
  return workspaceSlug
    ? { ok: true, presentedKey, workspaceSlug }
    : {
        ok: false,
        response: jsonResponse(
          {
            ok: false,
            error: {
              _tag: "ValidationFailed",
              message: "Assistant operations require workspaceSlug.",
            },
          },
          400,
        ),
      };
};

const brainPagesApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: BrainPageOperationId,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const admission = admitBrainApiRequest(request, operationId, body);
  if (!admission.ok) return admission.response;
  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(admission.presentedKey),
    workspaceSlug: admission.workspaceSlug,
    requiredScope: brainPageWriteOperations.has(operationId)
      ? "workspace:write"
      : "workspace:read",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) return brainActorFailure(actor);

  const input = {
    ...body.input,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
  };
  const ref = brainPageActorRefs[operationId];
  const result = brainPageWriteOperations.has(operationId)
    ? await ctx.runMutation(ref, input)
    : await ctx.runQuery(ref, input);
  return jsonResponse({ ok: true, operationId, result });
};

const brainAskApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const admission = admitAssistantApiRequest(request, body);
  if (!admission.ok) return admission.response;
  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(admission.presentedKey),
    workspaceSlug: admission.workspaceSlug,
    requiredScope: "workspace:read",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) return brainActorFailure(actor);
  const result = await ctx.runQuery(brainAskForActorRef, {
    ...body.input,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
  });
  return jsonResponse({ ok: true, operationId: brainAskOperationId, result });
};

const assistantAnswerApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const admission = admitAssistantApiRequest(request, body);
  if (!admission.ok) return admission.response;
  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(admission.presentedKey),
    workspaceSlug: admission.workspaceSlug,
    requiredScope: "workspace:read",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) return brainActorFailure(actor);
  const result = await ctx.runQuery(assistantAnswerForActorRef, {
    ...body.input,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
  });
  return jsonResponse({
    ok: true,
    operationId: assistantAnswerOperationId,
    result,
  });
};

const brainKnowledgeExtractionApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const admission = admitAssistantApiRequest(request, body);
  if (!admission.ok) return admission.response;
  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(admission.presentedKey),
    workspaceSlug: admission.workspaceSlug,
    requiredScope: "workspace:write",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) return brainActorFailure(actor);
  const result = await ctx.runMutation(brainKnowledgeExtractionForActorRef, {
    ...body.input,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
  });
  return jsonResponse({
    ok: true,
    operationId: brainKnowledgeExtractionOperationId,
    result,
  });
};

const assistantSaveExampleApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const admission = admitAssistantApiRequest(request, body);
  if (!admission.ok) return admission.response;
  if (!body.idempotencyKey?.trim())
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "ValidationFailed",
          message: `${assistantSaveExampleOperationId} requires a nonblank idempotencyKey.`,
        },
      },
      400,
    );
  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(admission.presentedKey),
    workspaceSlug: admission.workspaceSlug,
    requiredScope: "workspace:write",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) return brainActorFailure(actor);
  const result = await ctx.runMutation(assistantSaveExampleForActorRef, {
    ...body.input,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
  });
  return jsonResponse({
    ok: true,
    operationId: assistantSaveExampleOperationId,
    result,
  });
};

const brainEvaluationApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: BrainEvaluationOperationId,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const admission = admitAssistantApiRequest(request, body);
  if (!admission.ok) return admission.response;
  if (
    brainEvaluationWriteOperations.has(operationId) &&
    !body.idempotencyKey?.trim()
  )
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "ValidationFailed",
          message: `${operationId} requires a nonblank idempotencyKey.`,
        },
      },
      400,
    );
  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(admission.presentedKey),
    workspaceSlug: admission.workspaceSlug,
    requiredScope: brainEvaluationWriteOperations.has(operationId)
      ? "workspace:write"
      : "workspace:read",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) return brainActorFailure(actor);
  const input = {
    ...body.input,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
  };
  const ref = brainEvaluationActorRefs[operationId];
  const result = brainEvaluationWriteOperations.has(operationId)
    ? await ctx.runMutation(ref, input)
    : await ctx.runQuery(ref, input);
  return jsonResponse({ ok: true, operationId, result });
};

const workspaceListApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const admission = admitAssistantApiRequest(request, body);
  if (!admission.ok) return admission.response;
  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(admission.presentedKey),
    workspaceSlug: admission.workspaceSlug,
    requiredScope: "workspace:read",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) return brainActorFailure(actor);
  const result = await ctx.runQuery(workspaceListForActorRef, {
    userId: actor.userId,
  });
  return jsonResponse({
    ok: true,
    operationId: workspaceListOperationId,
    result,
  });
};

const admitConnectionsApiRequest = (
  request: Request,
  operationId: ConnectionOperationId,
  body: TemplateApiRequestBody,
):
  | {
      readonly ok: true;
      readonly presentedKey: string;
      readonly workspaceSlug: string;
    }
  | { readonly ok: false; readonly response: Response } => {
  const presentedKey = parseBearerApiKey(
    request.headers.get("authorization") ?? undefined,
  );
  if (typeof presentedKey !== "string") {
    return {
      ok: false,
      response: recordsAuthFailure(
        presentedKey.code,
        presentedKey.message,
        401,
      ),
    };
  }
  const workspaceSlug = body.workspaceSlug?.trim() ?? "";
  const workspaceFailure = brainWorkspaceFailure(workspaceSlug);
  if (workspaceFailure) return { ok: false, response: workspaceFailure };
  if (
    connectionWriteOperations.has(operationId) &&
    !body.idempotencyKey?.trim()
  ) {
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: {
            _tag: "ValidationFailed",
            message: `Operation ${operationId} requires a nonblank idempotencyKey.`,
          },
        },
        400,
      ),
    };
  }
  return { ok: true, presentedKey, workspaceSlug };
};

const connectionsApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: ConnectionOperationId,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const admission = admitConnectionsApiRequest(request, operationId, body);
  if (!admission.ok) return admission.response;
  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(admission.presentedKey),
    workspaceSlug: admission.workspaceSlug,
    requiredScope: connectionWriteOperations.has(operationId)
      ? "workspace:write"
      : "workspace:read",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) return brainActorFailure(actor);

  const ref = connectionActorRefs[operationId];
  const input = {
    ...body.input,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
  };
  const result = connectionWriteOperations.has(operationId)
    ? await ctx.runMutation(ref, input)
    : await ctx.runQuery(ref, input);
  return jsonResponse({ ok: true, operationId, result });
};

const recordsApiResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: RecordOperationId,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const presentedKey = parseBearerApiKey(
    request.headers.get("authorization") ?? undefined,
  );
  if (typeof presentedKey !== "string") {
    return recordsAuthFailure(presentedKey.code, presentedKey.message, 401);
  }
  const workspaceSlug = body.workspaceSlug?.trim();
  if (!workspaceSlug) {
    return jsonResponse(
      {
        ok: false,
        error: {
          _tag: "ValidationFailed",
          message: "Records operations require workspaceSlug.",
        },
      },
      400,
    );
  }

  const actor = (await ctx.runQuery(resolveRecordsActorRef, {
    keyHash: await sha256Base64Url(presentedKey),
    workspaceSlug,
    requiredScope:
      operationId === "records.create" ? "workspace:write" : "workspace:read",
    nowMs: Date.now(),
  })) as RecordsActorResolution;
  if (!actor.ok) {
    const forbidden =
      actor.code === "API_KEY_FORBIDDEN" ||
      actor.code === "API_KEY_WORKSPACE_MISMATCH";
    return recordsAuthFailure(actor.code, actor.message, forbidden ? 403 : 401);
  }

  const input = {
    ...body.input,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
  };
  const result =
    operationId === "records.create"
      ? await ctx.runMutation(recordActorRefs[operationId], input)
      : await ctx.runQuery(recordActorRefs[operationId], input);
  return jsonResponse({ ok: true, operationId, result });
};

const recordsAuthFailure = (
  code: string,
  message: string,
  status: 401 | 403,
): Response =>
  jsonResponse(
    {
      ok: false,
      error: {
        _tag: status === 401 ? "Unauthorized" : "Forbidden",
        code,
        message,
      },
    },
    status,
  );

const responseForParsedTemplateApiBody = async (
  ctx: HeadlessHttpCtx,
  operationId: string,
  body: TemplateApiRequestBody,
): Promise<Response> => {
  const executorRequest = executorRequestFor(operationId, body);
  const response = executorRequest.ok
    ? jsonResponse(await runTemplateApiOperation(ctx, executorRequest.request))
    : jsonResponse(executorRequest);

  return response;
};

const notFoundRouteResponse = (pathname: string): Response =>
  jsonResponse({
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
  router.route({
    path: "/deploy-authority/consume",
    method: "POST",
    handler: httpActionGeneric((ctx, request) =>
      handleDeployAuthorityHttpRequest(
        {
          runQuery: (reference, input) =>
            ctx.runQuery(reference as never, input as never),
          runMutation: (reference, scope) =>
            ctx.runMutation(reference as never, scope as never),
        },
        request,
      ),
    ),
  });
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
    router.route({ path: route.path, method: route.method, handler });
  }
  return router;
};

export default buildTemplateHttpRouter();
