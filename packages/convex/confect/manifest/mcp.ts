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

export const buildGeneratedMcpTools = () =>
  confectManifest.functions
    .filter((entry) => (entry.surfaces as readonly string[]).includes("mcp"))
    .filter(
      (entry) => reviewedHeadlessPolicyFor(entry.operationId) !== undefined,
    )
    .map((entry) => ({
      name: `template.${entry.operationId}`,
      description: `Invoke ${entry.operationId} through the generated Confect contract manifest.`,
      inputSchema: mcpInputSchemaFor(entry.argsSchemaName),
      typedErrors: entry.typedErrors,
    }));
