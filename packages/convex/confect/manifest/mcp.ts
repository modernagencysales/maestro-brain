import {
  confectJsonSchemas,
  confectManifest,
} from "@maestro-template/template-core/generated/confectManifest";
import { reviewedHeadlessPolicyFor } from "../headless/authorizeOperation";

const mcpInputSchemaFor = (schemaName: string): unknown => {
  const schema =
    confectJsonSchemas.mcp[schemaName as keyof typeof confectJsonSchemas.mcp];

  if (schema === undefined) {
    throw new Error(`Missing MCP JSON schema for ${schemaName}.`);
  }

  return schema;
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
