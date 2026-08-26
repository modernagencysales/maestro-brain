import {
  confectJsonSchemas,
  confectManifest,
} from "@maestro-template/template-core/generated/confectManifest";
import { makeFunctionReference } from "convex/server";
import type { ApiKeyScope } from "./headless/auth";

export type McpToolConfig = {
  readonly description: string;
  readonly requiredScope: ApiKeyScope;
  readonly kind: "query" | "mutation";
  readonly ref: unknown;
};

export const brainMcpToolConfigs = {
  "agents.assistant.answerQuestion": {
    description:
      "Answer a company-context question from approved Brain evidence with ContextPack v3 citations and freshness.",
    requiredScope: "workspace:read",
    kind: "query",
    ref: makeFunctionReference<"query">(
      "agents/assistant:answerQuestionForActor",
    ),
  },
  "brain.pages.list": {
    description: "List Brain pages available to the credential's workspace.",
    requiredScope: "workspace:read",
    kind: "query",
    ref: makeFunctionReference<"query">("brain/pages:listForActor"),
  },
  "brain.pages.get": {
    description: "Open one Brain page by its stable page ID.",
    requiredScope: "workspace:read",
    kind: "query",
    ref: makeFunctionReference<"query">("brain/pages:getForActor"),
  },
  "brain.pages.createMarkdown": {
    description: "Create a Markdown Brain page in the credential's workspace.",
    requiredScope: "workspace:write",
    kind: "mutation",
    ref: makeFunctionReference<"mutation">(
      "brain/pages:createMarkdownForActor",
    ),
  },
  "brain.pages.updateMarkdown": {
    description: "Update a Brain page's Markdown using optimistic concurrency.",
    requiredScope: "workspace:write",
    kind: "mutation",
    ref: makeFunctionReference<"mutation">(
      "brain/pages:updateMarkdownForActor",
    ),
  },
  "brain.pages.history": {
    description: "List bounded revision history for one Brain page.",
    requiredScope: "workspace:read",
    kind: "query",
    ref: makeFunctionReference<"query">("brain/pages:historyForActor"),
  },
} as const satisfies Record<string, McpToolConfig>;

export type McpToolOperationId = keyof typeof brainMcpToolConfigs;

const forbiddenSelectorKeys = new Set([
  "organizationId",
  "tenantId",
  "userId",
  "workspaceId",
  "workspaceSlug",
]);

export const hasForbiddenMcpSelector = (
  input: Record<string, unknown>,
): boolean => Object.keys(input).some((key) => forbiddenSelectorKeys.has(key));

const generatedSchemaFor = (
  operationId: McpToolOperationId,
): Record<string, unknown> => {
  const entry = confectManifest.functions.find(
    (candidate) => candidate.operationId === operationId,
  );
  if (entry === undefined)
    throw new Error(`Missing generated contract for ${operationId}.`);
  const source = confectJsonSchemas.mcp[
    entry.argsSchemaName as keyof typeof confectJsonSchemas.mcp
  ] as Record<string, unknown> | undefined;
  if (source === undefined)
    throw new Error(`Missing generated MCP schema for ${operationId}.`);
  return source;
};

const safePropertiesFor = (
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const properties = { ...(source.properties as Record<string, unknown>) };
  for (const key of forbiddenSelectorKeys) delete properties[key];
  return properties;
};

const safeRequiredFor = (source: Record<string, unknown>): readonly string[] =>
  Array.isArray(source.required)
    ? source.required.filter(
        (key): key is string =>
          typeof key === "string" && !forbiddenSelectorKeys.has(key),
      )
    : [];

const inputSchemaFor = (
  operationId: McpToolOperationId,
): Record<string, unknown> => {
  const source = generatedSchemaFor(operationId);
  return {
    ...source,
    properties: safePropertiesFor(source),
    required: safeRequiredFor(source),
  };
};

export const buildBrainMcpTools = () =>
  (Object.keys(brainMcpToolConfigs) as McpToolOperationId[]).map(
    (operationId) => {
      const config = brainMcpToolConfigs[operationId];
      return {
        name: `template.${operationId}`,
        description: config.description,
        inputSchema: inputSchemaFor(operationId),
        annotations: {
          readOnlyHint: config.kind === "query",
          destructiveHint: false,
          idempotentHint: config.kind === "query",
          openWorldHint: false,
        },
      };
    },
  );
