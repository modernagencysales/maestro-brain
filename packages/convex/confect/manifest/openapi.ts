import {
  confectJsonSchemas,
  confectManifest,
} from "@maestro-template/template-core/generated/confectManifest";

const openApiRequestSchemaFor = (schemaName: string): unknown => {
  const schema =
    confectJsonSchemas.openApi31[
      schemaName as keyof typeof confectJsonSchemas.openApi31
    ];

  if (schema === undefined) {
    throw new Error(`Missing OpenAPI JSON schema for ${schemaName}.`);
  }

  return schema;
};

const envelopeSchemaFor = (
  entry: (typeof confectManifest.functions)[number],
) => {
  const required = ["input"];
  if (!entry.idempotent) {
    required.push("idempotencyKey");
  }

  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      workspaceSlug: { type: "string" },
      input: openApiRequestSchemaFor(entry.argsSchemaName),
      idempotencyKey: { type: "string" },
    },
  };
};

export const buildGeneratedOpenApiDocument = () => ({
  openapi: "3.1.0" as const,
  info: {
    title: "Maestro Template Headless API",
    version: "0.1.0",
    description: "Generated from Confect contract manifest metadata.",
  },
  paths: Object.fromEntries(
    confectManifest.functions
      .filter((entry) => (entry.surfaces as readonly string[]).includes("api"))
      .map((entry) => [
        `/api/${entry.operationId}`,
        {
          post: {
            operationId: entry.operationId,
            tags: ["template-headless"],
            "x-maestro-auth-scope": "workspace member",
            "x-maestro-typed-errors": entry.typedErrors,
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: envelopeSchemaFor(entry),
                },
              },
            },
            responses: {
              "200": { description: "Typed operation result." },
              "400": { description: "Declared typed failure." },
            },
          },
        },
      ]),
  ),
});
