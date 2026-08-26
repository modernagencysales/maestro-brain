import { makeFunctionReference } from "convex/server";
import type { ApiKeyScope } from "./headless/auth";
import { parseBearerApiKey } from "./headless/auth";
import {
  brainMcpToolConfigs,
  buildBrainMcpTools,
  hasForbiddenMcpSelector,
  type McpToolConfig,
  type McpToolOperationId,
} from "./httpMcpCatalog";
import { sha256Base64Url } from "./shared/tokenCrypto";

export type McpHttpCtx = {
  readonly runQuery: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runMutation: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
};

type JsonResponder = (value: unknown, status?: number) => Response;

type McpRequest = {
  readonly jsonrpc: "2.0";
  readonly id?: string | number;
  readonly method:
    "initialize" | "prompts/list" | "prompts/get" | "tools/list" | "tools/call";
  readonly params?: {
    readonly protocolVersion?: string;
    readonly name?: string;
    readonly arguments?: Record<string, unknown>;
  };
};

type CredentialActor =
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

const credentialResolverRef = makeFunctionReference<"query">(
  "headless/apiKeys:resolveCredential",
);

const askBrainPrompt = {
  name: "ask-company-brain",
  title: "Ask Company Brain",
  description:
    "Answer from approved Company Brain evidence with exact citations, freshness, and explicit abstention.",
  arguments: [
    {
      name: "question",
      description: "The company-context question to answer.",
      required: true,
    },
  ],
} as const;

const askBrainMessage = (
  question: string,
): string => `Answer the question below using only approved Company Brain evidence.

Call \`template.agents.assistant.answerQuestion\` with this exact question:
${JSON.stringify(question)}

Continue only when the result contains ContextPack schema version 3 and candidate-manifest version 2. Cite every material claim using the returned exact citation identities and state freshness and as-of time. If the tool returns insufficient context, authorization fails, the contract is wrong, or citations cannot be reopened, abstain and name the missing evidence. Do not invent company facts or send workspace, user, organization, or tenant identifiers.`;

const mcpReply = (
  respond: JsonResponder,
  id: string | number | undefined,
  result: unknown,
): Response =>
  respond({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), result });

const mcpError = (
  respond: JsonResponder,
  id: string | number | undefined,
  code: number,
  message: string,
): Response =>
  respond({
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    error: { code, message },
  });

const toolError = (
  respond: JsonResponder,
  id: string | number | undefined,
  error: unknown,
): Response =>
  mcpReply(respond, id, {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }],
  });

const promptGetResponse = (
  respond: JsonResponder,
  candidate: Partial<McpRequest>,
): Response => {
  if (candidate.params?.name !== askBrainPrompt.name)
    return mcpError(
      respond,
      candidate.id,
      -32602,
      "Unknown or unavailable MCP prompt.",
    );
  const question = candidate.params.arguments?.question;
  if (typeof question !== "string" || question.trim().length === 0)
    return mcpError(
      respond,
      candidate.id,
      -32602,
      "MCP prompt question must be a non-empty string.",
    );
  return mcpReply(respond, candidate.id, {
    description: askBrainPrompt.description,
    messages: [
      {
        role: "user",
        content: { type: "text", text: askBrainMessage(question) },
      },
    ],
  });
};

const operationIdForTool = (name: unknown): McpToolOperationId | undefined => {
  const operationId =
    typeof name === "string" && name.startsWith("template.")
      ? name.slice("template.".length)
      : "";
  return operationId in brainMcpToolConfigs
    ? (operationId as McpToolOperationId)
    : undefined;
};

const resolveCredentialActor = async (
  ctx: McpHttpCtx,
  request: Request,
  requiredScope: ApiKeyScope,
): Promise<CredentialActor> => {
  const presented = parseBearerApiKey(
    request.headers.get("authorization") ?? undefined,
  );
  if (typeof presented !== "string")
    return { ok: false, code: presented.code, message: presented.message };
  return (await ctx.runQuery(credentialResolverRef, {
    keyHash: await sha256Base64Url(presented),
    requiredScope,
    nowMs: Date.now(),
  })) as CredentialActor;
};

type ToolAdmission =
  | {
      readonly ok: true;
      readonly operationId: McpToolOperationId;
      readonly config: McpToolConfig;
      readonly input: Record<string, unknown>;
      readonly actor: Extract<CredentialActor, { readonly ok: true }>;
    }
  | { readonly ok: false; readonly response: Response };

const admitToolCall = async (
  ctx: McpHttpCtx,
  request: Request,
  respond: JsonResponder,
  candidate: Partial<McpRequest>,
): Promise<ToolAdmission> => {
  const operationId = operationIdForTool(candidate.params?.name);
  if (operationId === undefined)
    return {
      ok: false,
      response: mcpError(
        respond,
        candidate.id,
        -32602,
        "Unknown or unavailable MCP tool.",
      ),
    };
  const input = candidate.params?.arguments ?? {};
  if (hasForbiddenMcpSelector(input))
    return {
      ok: false,
      response: mcpError(
        respond,
        candidate.id,
        -32602,
        "Workspace and principal selectors are derived from the bearer credential.",
      ),
    };

  const config = brainMcpToolConfigs[operationId];
  const actor = await resolveCredentialActor(
    ctx,
    request,
    config.requiredScope,
  );
  return actor.ok
    ? { ok: true, operationId, config, input, actor }
    : {
        ok: false,
        response: toolError(respond, candidate.id, {
          _tag:
            actor.code === "API_KEY_FORBIDDEN" ? "Forbidden" : "Unauthorized",
          code: actor.code,
          message: actor.message,
        }),
      };
};

const executeTool = async (
  ctx: McpHttpCtx,
  admission: Extract<ToolAdmission, { readonly ok: true }>,
): Promise<unknown> => {
  const args = {
    ...admission.input,
    workspaceId: admission.actor.workspaceId,
    userId: admission.actor.userId,
  };
  return admission.config.kind === "mutation"
    ? await ctx.runMutation(admission.config.ref, args)
    : await ctx.runQuery(admission.config.ref, args);
};

const toolCallResponse = async (
  ctx: McpHttpCtx,
  request: Request,
  respond: JsonResponder,
  candidate: Partial<McpRequest>,
): Promise<Response> => {
  const admission = await admitToolCall(ctx, request, respond, candidate);
  if (!admission.ok) return admission.response;
  try {
    const result = await executeTool(ctx, admission);
    return mcpReply(respond, candidate.id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            operationId: admission.operationId,
            result,
          }),
        },
      ],
    });
  } catch {
    return toolError(respond, candidate.id, {
      _tag: "ToolExecutionFailed",
      message: "Brain tool execution failed.",
    });
  }
};

const initializedResponse = (
  respond: JsonResponder,
  id: string | number | undefined,
  requestedProtocolVersion: string | undefined,
): Response =>
  mcpReply(respond, id, {
    protocolVersion:
      requestedProtocolVersion === "2025-03-26" ||
      requestedProtocolVersion === "2024-11-05"
        ? requestedProtocolVersion
        : "2025-06-18",
    capabilities: { prompts: {}, tools: {} },
    serverInfo: { name: "maestro-brain", version: "1.0.0" },
  });

type McpHandler = (
  ctx: McpHttpCtx,
  request: Request,
  respond: JsonResponder,
  candidate: Partial<McpRequest>,
) => Response | Promise<Response>;

const mcpHandlers: Readonly<Record<string, McpHandler | undefined>> = {
  initialize: (_ctx, _request, respond, candidate) =>
    initializedResponse(
      respond,
      candidate.id,
      candidate.params?.protocolVersion,
    ),
  "notifications/initialized": () => new Response(null, { status: 202 }),
  "prompts/list": (_ctx, _request, respond, candidate) =>
    mcpReply(respond, candidate.id, { prompts: [askBrainPrompt] }),
  "prompts/get": (_ctx, _request, respond, candidate) =>
    promptGetResponse(respond, candidate),
  "tools/list": (_ctx, _request, respond, candidate) =>
    mcpReply(respond, candidate.id, { tools: buildBrainMcpTools() }),
  "tools/call": (ctx, request, respond, candidate) =>
    toolCallResponse(ctx, request, respond, candidate),
};

const responseForMcpRequest = async (
  ctx: McpHttpCtx,
  request: Request,
  respond: JsonResponder,
  candidate: Partial<McpRequest>,
): Promise<Response> => {
  if (candidate.jsonrpc !== "2.0" || typeof candidate.method !== "string")
    return mcpError(respond, candidate.id, -32600, "Invalid MCP request.");
  const handler = mcpHandlers[candidate.method];
  return handler === undefined
    ? mcpError(respond, candidate.id, -32601, "Method not found.")
    : await handler(ctx, request, respond, candidate);
};

type ParsedMcpRequest =
  | { readonly ok: true; readonly candidate: Partial<McpRequest> }
  | { readonly ok: false; readonly response: Response };

const parseMcpRequest = async (
  request: Request,
  respond: JsonResponder,
): Promise<ParsedMcpRequest> => {
  if (request.method !== "POST")
    return {
      ok: false,
      response: mcpError(
        respond,
        undefined,
        -32600,
        "Only POST is supported for /mcp.",
      ),
    };
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return {
      ok: false,
      response: mcpError(
        respond,
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
      response: mcpError(
        respond,
        undefined,
        -32700,
        "Request body must be valid JSON.",
      ),
    };
  }
  return body === null || typeof body !== "object" || Array.isArray(body)
    ? {
        ok: false,
        response: mcpError(
          respond,
          undefined,
          -32600,
          "MCP request must be a JSON object.",
        ),
      }
    : { ok: true, candidate: body as Partial<McpRequest> };
};

export const handleMcpHttpRequest = async (
  ctx: McpHttpCtx,
  request: Request,
  respond: JsonResponder,
): Promise<Response> => {
  const parsed = await parseMcpRequest(request, respond);
  return parsed.ok
    ? await responseForMcpRequest(ctx, request, respond, parsed.candidate)
    : parsed.response;
};
