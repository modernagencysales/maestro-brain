import { buildGeneratedMcpTools } from "./manifest/mcp";
import { reviewedHeadlessPolicyFor } from "./headless/authorizeOperation";
import { jsonResponse } from "./httpResponses";
import type { HeadlessHttpCtx } from "./httpTypes";

type McpRequest = {
  readonly jsonrpc: "2.0";
  readonly id?: string | number;
  readonly method:
    "initialize" | "prompts/list" | "prompts/get" | "tools/list" | "tools/call";
  readonly params?: {
    readonly name?: string;
    readonly arguments?: Record<string, unknown>;
  };
};

type ExecuteApiRoute = (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: string,
) => Promise<Response>;

type ParsedMcpRequest =
  | { readonly ok: true; readonly request: Partial<McpRequest> }
  | { readonly ok: false; readonly response: Response };

const askAperoPrompt = {
  name: "ask-apero",
  title: "Ask Apero",
  description:
    "Answer a question from Apero's approved Brain evidence with citations and explicit abstention when evidence is insufficient.",
  arguments: [
    {
      name: "question",
      description:
        "The question to answer using Apero's approved Brain evidence.",
      required: true,
    },
  ],
} as const;

const askAperoMessage = (
  question: string,
): string => `Answer the question below using Apero's approved Brain evidence.

First call the \`template.brain.context.get\` MCP tool with this exact question:
${JSON.stringify(question)}

Treat the tool result as the only source of company facts. Continue only when it is ContextPack schema version 3 with candidate-manifest version 2. Include exact reopenable citations with every material claim. State the pack's as-of time, coverage gaps, stale or unknown freshness, conflicts, omissions, truncation, and readiness. Label any reasoning beyond retrieved text as agent inference.

If authorization fails, required coverage is unavailable, the response contract is wrong, the candidate manifest is absent, or an exact citation cannot be reopened, stop and say what evidence is missing. Do not invent or supplement company facts from prior knowledge. Do not call provider or Brain evidence-write tools.`;

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

const readMcpRequest = async (request: Request): Promise<ParsedMcpRequest> => {
  if (request.method !== "POST")
    return {
      ok: false,
      response: mcpError(undefined, -32600, "Only POST is supported for /mcp."),
    };
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return {
      ok: false,
      response: mcpError(
        undefined,
        -32600,
        "Content-Type must be application/json.",
      ),
    };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: mcpError(undefined, -32700, "Request body must be valid JSON."),
    };
  }
  return body === null || typeof body !== "object" || Array.isArray(body)
    ? {
        ok: false,
        response: mcpError(
          undefined,
          -32600,
          "MCP request must be a JSON object.",
        ),
      }
    : { ok: true, request: body as Partial<McpRequest> };
};

const promptGetResponse = (candidate: Partial<McpRequest>): Response => {
  const id = candidate.id;
  if (candidate.params?.name !== askAperoPrompt.name)
    return mcpError(id, -32602, "Unknown or unavailable MCP prompt.");

  const question = candidate.params.arguments?.question;
  if (typeof question !== "string" || question.trim().length === 0)
    return mcpError(
      id,
      -32602,
      "MCP prompt question must be a non-empty string.",
    );

  return mcpReply(id, {
    description: askAperoPrompt.description,
    messages: [
      {
        role: "user",
        content: { type: "text", text: askAperoMessage(question) },
      },
    ],
  });
};

const operationIdForTool = (name: unknown): string | undefined =>
  typeof name === "string" && name.startsWith("template.")
    ? name.slice("template.".length)
    : undefined;

const successfulOperationEnvelope = (
  response: Response,
  value: unknown,
): boolean => {
  if (!response.ok || value === null || typeof value !== "object") return false;
  return Reflect.get(value, "ok") === true;
};

const toolCallResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  candidate: Partial<McpRequest>,
  executeApiRoute: ExecuteApiRoute,
): Promise<Response> => {
  const id = candidate.id;
  const operationId = operationIdForTool(candidate.params?.name);
  if (
    operationId === undefined ||
    reviewedHeadlessPolicyFor(operationId) === undefined
  )
    return mcpError(id, -32602, "Unknown or unavailable MCP tool.");

  const apiRequest = new Request(
    `${new URL(request.url).origin}/api/${operationId}`,
    {
      method: "POST",
      headers: {
        authorization: request.headers.get("authorization") ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: candidate.params?.arguments ?? {} }),
    },
  );
  const executed = await executeApiRoute(ctx, apiRequest, operationId);
  const result = await executed.json();
  const content = [{ type: "text", text: JSON.stringify(result) }];
  return successfulOperationEnvelope(executed, result)
    ? mcpReply(id, { content })
    : mcpReply(id, { isError: true, content });
};

const initializedResponse = (id: string | number | undefined): Response =>
  mcpReply(id, {
    protocolVersion: "2025-06-18",
    capabilities: { prompts: {}, tools: {} },
    serverInfo: { name: "maestro-brain", version: "1.0.0" },
  });

type McpHandler = (
  ctx: HeadlessHttpCtx,
  request: Request,
  candidate: Partial<McpRequest>,
  executeApiRoute: ExecuteApiRoute,
) => Response | Promise<Response>;

const mcpHandlers: Readonly<Record<string, McpHandler | undefined>> = {
  initialize: (_ctx, _request, candidate) => initializedResponse(candidate.id),
  "prompts/list": (_ctx, _request, candidate) =>
    mcpReply(candidate.id, { prompts: [askAperoPrompt] }),
  "prompts/get": (_ctx, _request, candidate) => promptGetResponse(candidate),
  "tools/list": (_ctx, _request, candidate) =>
    mcpReply(candidate.id, { tools: buildGeneratedMcpTools() }),
  "tools/call": (ctx, request, candidate, executeApiRoute) =>
    toolCallResponse(ctx, request, candidate, executeApiRoute),
};

const responseForMcpRequest = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  candidate: Partial<McpRequest>,
  executeApiRoute: ExecuteApiRoute,
): Promise<Response> => {
  const id = candidate.id;
  if (candidate.jsonrpc !== "2.0" || typeof candidate.method !== "string")
    return mcpError(id, -32600, "Invalid MCP request.");

  const handler = mcpHandlers[candidate.method];
  return handler === undefined
    ? mcpError(id, -32601, "Method not found.")
    : await handler(ctx, request, candidate, executeApiRoute);
};

export const mcpRouteResponse = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  executeApiRoute: ExecuteApiRoute,
): Promise<Response> => {
  const parsed = await readMcpRequest(request);
  return parsed.ok
    ? await responseForMcpRequest(ctx, request, parsed.request, executeApiRoute)
    : parsed.response;
};
