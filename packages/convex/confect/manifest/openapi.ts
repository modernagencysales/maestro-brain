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

const credentialDerivedEvaluationFields = new Set(["workspaceId", "userId"]);
const credentialDerivedEvaluationOperations = new Set([
  "brain.evaluations.adjudicate",
  "brain.evaluations.export",
  "brain.evaluations.freezeApply",
  "brain.evaluations.freezePreview",
  "brain.evaluations.get",
  "brain.evaluations.list",
]);
const envelopeIdempotencyOverrides = new Set(["brain.evaluations.freezeApply"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const callerInputSchemaFor = (
  entry: (typeof confectManifest.functions)[number],
): unknown => {
  const schema = openApiRequestSchemaFor(entry.argsSchemaName);
  if (
    !credentialDerivedEvaluationOperations.has(entry.operationId) ||
    !isRecord(schema)
  )
    return schema;

  const properties = isRecord(schema.properties)
    ? Object.fromEntries(
        Object.entries(schema.properties).filter(
          ([field]) => !credentialDerivedEvaluationFields.has(field),
        ),
      )
    : undefined;
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (field) =>
          typeof field !== "string" ||
          !credentialDerivedEvaluationFields.has(field),
      )
    : undefined;

  return {
    ...schema,
    ...(properties === undefined ? {} : { properties }),
    ...(required === undefined ? {} : { required }),
  };
};

const envelopeSchemaFor = (
  entry: (typeof confectManifest.functions)[number],
) => {
  const required = ["input"];
  if (credentialDerivedEvaluationOperations.has(entry.operationId)) {
    required.push("workspaceSlug");
  }
  if (
    !entry.idempotent ||
    envelopeIdempotencyOverrides.has(entry.operationId)
  ) {
    required.push("idempotencyKey");
  }

  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      workspaceSlug: { type: "string", minLength: 1 },
      input: callerInputSchemaFor(entry),
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
