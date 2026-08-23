import {
  confectJsonSchemas,
  confectManifest,
} from "@maestro-template/template-core/generated/confectManifest";
import {
  isServerDerivedHeadlessInputField,
  reviewedHeadlessPolicyFor,
} from "../headless/authorizeOperation";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const callerInputSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(callerInputSchema);
  if (!isRecord(value)) return value;

  const projected = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      callerInputSchema(nested),
    ]),
  );
  if (isRecord(value.properties)) {
    projected.properties = Object.fromEntries(
      Object.entries(value.properties)
        .filter(([field]) => !isServerDerivedHeadlessInputField(field))
        .map(([field, schema]) => [field, callerInputSchema(schema)]),
    );
  }
  if (Array.isArray(value.required)) {
    projected.required = value.required.filter(
      (field) =>
        typeof field !== "string" || !isServerDerivedHeadlessInputField(field),
    );
  }
  return projected;
};

const mcpInputSchemaFor = (schemaName: string): unknown => {
  const schema =
    confectJsonSchemas.mcp[schemaName as keyof typeof confectJsonSchemas.mcp];

  if (schema === undefined) {
    throw new Error(`Missing MCP JSON schema for ${schemaName}.`);
  }

  return callerInputSchema(schema);
};

const toolDescriptions: Readonly<Record<string, string>> = {
  "brain.answers.ask":
    "Synthesize a grounded answer from approved Company Brain evidence.",
  "brain.context.get":
    "Retrieve a bounded ContextPack with evidence, coverage, freshness, and exact citation identities.",
  "brain.pages.get": "Open one approved Company Brain page by its stable key.",
  "brain.pages.history":
    "List approved revision history for one Company Brain page.",
  "brain.pages.list": "List approved Company Brain pages available in scope.",
  "brain.sources.get":
    "Open one approved source using its exact publication-set and entry keys.",
  "brain.sources.search":
    "Search approved Company Brain sources to refine a retrieval miss.",
};

export const buildGeneratedMcpTools = () =>
  confectManifest.functions
    .filter((entry) => (entry.surfaces as readonly string[]).includes("mcp"))
    .filter(
      (entry) => reviewedHeadlessPolicyFor(entry.operationId) !== undefined,
    )
    .map((entry) => ({
      name: `template.${entry.operationId}`,
      description:
        toolDescriptions[entry.operationId] ??
        `Read approved Company Brain data with ${entry.operationId}.`,
      inputSchema: mcpInputSchemaFor(entry.argsSchemaName),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      typedErrors: entry.typedErrors,
    }));
