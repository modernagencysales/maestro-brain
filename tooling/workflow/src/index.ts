import {
  createSampleWorkflowRunReceipt,
  templateRegistry,
  validateTemplateRegistry,
  type CapabilityDefinition,
  type HeadlessSurface,
  type TemplateRegistry,
  type WorkflowRunReceipt,
} from "@maestro-template/template-core";

export type HeadlessOperation = {
  readonly id: string;
  readonly surface: HeadlessSurface["name"];
  readonly capability: CapabilityDefinition["name"];
  readonly route: string;
  readonly authScope: string;
  readonly typedErrors: readonly string[];
};

export type ApiCatalogEntry = {
  readonly operationId: string;
  readonly method: "POST";
  readonly path: string;
  readonly authScope: string;
  readonly typedErrors: readonly string[];
};

export type TemplateApiRequest = {
  readonly workspaceSlug?: string;
  readonly input?: Record<string, unknown>;
  readonly idempotencyKey?: string;
};

export type TemplateApiResult =
  | {
      readonly ok: true;
      readonly operationId: string;
      readonly result: Record<string, unknown>;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly _tag:
          "NotFound" | "ValidationFailed" | "Unauthorized" | "FeatureDisabled";
        readonly message: string;
      };
    };

type JsonSchema = {
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly string[];
  readonly additionalProperties?: boolean;
};

export type OpenApiDocument = {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly paths: Record<
    string,
    {
      readonly post: {
        readonly operationId: string;
        readonly summary: string;
        readonly description: string;
        readonly tags: readonly string[];
        readonly security: readonly {
          readonly bearerAuth: readonly string[];
        }[];
        readonly "x-maestro-auth-scope": string;
        readonly "x-maestro-typed-errors": readonly string[];
        readonly requestBody: {
          readonly required: true;
          readonly content: {
            readonly "application/json": {
              readonly schema: JsonSchema;
              readonly example: Record<string, unknown>;
            };
          };
        };
        readonly responses: Record<
          string,
          {
            readonly description: string;
            readonly content: {
              readonly "application/json": {
                readonly schema: JsonSchema;
                readonly examples?: Record<
                  string,
                  { readonly value: Record<string, unknown> }
                >;
              };
            };
          }
        >;
      };
    }
  >;
  readonly components: {
    readonly securitySchemes: {
      readonly bearerAuth: {
        readonly type: "http";
        readonly scheme: "bearer";
      };
    };
    readonly schemas: Record<string, JsonSchema>;
  };
};

export type McpToolEntry = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly typedErrors: readonly string[];
};

export type McpToolCallResult = {
  readonly isError: boolean;
  readonly content: readonly {
    readonly type: "text";
    readonly text: string;
  }[];
};

export const buildHeadlessOperations = (
  registry: TemplateRegistry = templateRegistry,
): readonly HeadlessOperation[] =>
  registry.headlessSurfaces.flatMap((surface) =>
    registry.capabilities.map((capability) => ({
      id: `${surface.name}:${capability.name}`,
      surface: surface.name,
      capability: capability.name,
      route: surface.route,
      authScope: capability.policy,
      typedErrors: capability.typedErrors,
    })),
  );

export const describeWorkflowTemplate = (
  registry: TemplateRegistry = templateRegistry,
) => {
  const validationErrors = validateTemplateRegistry(registry);

  return {
    valid: validationErrors.length === 0,
    validationErrors,
    nodeCount: registry.workflow.nodes.length,
    edgeCount: registry.workflow.edges.length,
    capabilityCount: registry.capabilities.length,
    agentCount: registry.agents.length,
    headlessOperationCount: buildHeadlessOperations(registry).length,
  };
};

export const getHeadlessOperation = (
  id: string,
  registry: TemplateRegistry = templateRegistry,
): HeadlessOperation | undefined =>
  buildHeadlessOperations(registry).find((operation) => operation.id === id);

export const buildApiCatalog = (
  registry: TemplateRegistry = templateRegistry,
): readonly ApiCatalogEntry[] =>
  buildHeadlessOperations(registry)
    .filter((operation) => operation.surface === "Scalar API")
    .map((operation) => ({
      operationId: operation.capability,
      method: "POST",
      path: `/api/${operation.capability}`,
      authScope: operation.authScope,
      typedErrors: operation.typedErrors,
    }));

const baseRequestSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["workspaceSlug", "input"],
  properties: {
    workspaceSlug: {
      type: "string",
      description: "Server-authorized workspace slug or instance alias.",
    },
    input: {
      type: "object",
      description:
        "Capability-specific input. Generated Confect refs provide the exact Effect schema in the implementation package.",
      additionalProperties: true,
    },
    idempotencyKey: {
      type: "string",
      description: "Required for externally visible writes.",
    },
  },
};

const successResponseSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "operationId", "result"],
  properties: {
    ok: { type: "boolean" },
    operationId: { type: "string" },
    result: {
      type: "object",
      description:
        "Typed capability result encoded by the generated Confect function.",
      additionalProperties: true,
    },
  },
};

const typedErrorSchema = (typedErrors: readonly string[]): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required: ["ok", "error"],
  properties: {
    ok: { type: "boolean" },
    error: {
      type: "object",
      additionalProperties: false,
      required: ["_tag", "message"],
      properties: {
        _tag: {
          type: "string",
          enum: typedErrors,
          description: "Declared public typed error variant.",
        },
        message: {
          type: "string",
          description: "Redacted user-safe error message.",
        },
      },
    },
  },
});

const mcpInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    workspaceSlug: {
      type: "string",
      description: "Reviewer-safe workspace slug. Defaults to acme-demo.",
    },
  },
};

const apiExampleFor = (
  entry: ApiCatalogEntry,
): {
  readonly request: Record<string, unknown>;
  readonly success: Record<string, unknown>;
  readonly typedError: Record<string, unknown>;
} => ({
  request: {
    workspaceSlug: "acme-demo",
    input: {
      sample: entry.operationId,
    },
    idempotencyKey: `${entry.operationId}-example-001`,
  },
  success: {
    ok: true,
    operationId: entry.operationId,
    result: {
      receiptId:
        entry.operationId === "createTrustReceipt"
          ? "receipt_template_001"
          : undefined,
      status: "accepted",
    },
  },
  typedError: {
    ok: false,
    error: {
      _tag: entry.typedErrors[0] ?? "ValidationFailed",
      message: "Request failed a declared template policy check.",
    },
  },
});

export const buildOpenApiDocument = (
  registry: TemplateRegistry = templateRegistry,
): OpenApiDocument => {
  const apiEntries = buildApiCatalog(registry);

  return {
    openapi: "3.1.0",
    info: {
      title: "Maestro Template Headless API",
      version: "0.1.0",
      description:
        "Generated from the shared template registry. The live Confect HTTP implementation mounts the same operations for Scalar.",
    },
    paths: Object.fromEntries(
      apiEntries.map((entry) => {
        const examples = apiExampleFor(entry);

        return [
          entry.path,
          {
            post: {
              operationId: entry.operationId,
              summary: `Run ${entry.operationId}`,
              description:
                "Calls the same typed capability/workflow contract used by the web, CLI, and MCP surfaces.",
              tags: ["template-headless"],
              security: [{ bearerAuth: [entry.authScope] }],
              "x-maestro-auth-scope": entry.authScope,
              "x-maestro-typed-errors": entry.typedErrors,
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: baseRequestSchema,
                    example: examples.request,
                  },
                },
              },
              responses: {
                "200": {
                  description: "Typed capability result.",
                  content: {
                    "application/json": {
                      schema: successResponseSchema,
                      examples: {
                        success: { value: examples.success },
                      },
                    },
                  },
                },
                "400": {
                  description: "Declared typed failure.",
                  content: {
                    "application/json": {
                      schema: typedErrorSchema(entry.typedErrors),
                      examples: {
                        typedError: { value: examples.typedError },
                      },
                    },
                  },
                },
              },
            },
          },
        ];
      }),
    ),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
      schemas: {
        TemplateOperationRequest: baseRequestSchema,
        TemplateOperationSuccess: successResponseSchema,
      },
    },
  };
};

export const runTemplateApiOperation = (
  operationId: string,
  request: TemplateApiRequest = {},
  registry: TemplateRegistry = templateRegistry,
): TemplateApiResult => {
  const operation = buildApiCatalog(registry).find(
    (entry) => entry.operationId === operationId,
  );

  if (!operation) {
    return {
      ok: false,
      error: {
        _tag: "NotFound",
        message: `Unknown template API operation: ${operationId}`,
      },
    };
  }

  const workspaceSlug = request.workspaceSlug?.trim() || "acme-demo";

  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(workspaceSlug)) {
    return {
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "workspaceSlug must be a lowercase slug.",
      },
    };
  }

  if (
    operation.authScope.includes("write") &&
    !request.idempotencyKey?.trim()
  ) {
    return {
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "idempotencyKey is required for write operations.",
      },
    };
  }

  if (operationId === "createTrustReceipt") {
    const receipt = runTemplateWorkflow(registry);

    return {
      ok: true,
      operationId,
      result: {
        status: "accepted",
        workspaceSlug,
        receiptId: receipt.trustReceipt.receiptId,
        claim: receipt.trustReceipt.claim,
        sourceTitles: receipt.trustReceipt.sourceTitles,
        workflowRunId: receipt.runId,
      },
    };
  }

  return {
    ok: true,
    operationId,
    result: {
      status: "accepted",
      workspaceSlug,
      source: "shared-template-registry",
      inputEcho: request.input ?? {},
    },
  };
};

export const buildMcpTools = (
  registry: TemplateRegistry = templateRegistry,
): readonly McpToolEntry[] => [
  ...buildHeadlessOperations(registry)
    .filter((operation) => operation.surface === "MCP")
    .map((operation) => ({
      name: `template.${operation.capability}`,
      description: `Invoke ${operation.capability} through the shared template registry.`,
      inputSchema: mcpInputSchema,
      typedErrors: operation.typedErrors,
    })),
  {
    name: "template.workflow.run",
    description:
      "Run the deterministic reviewer-safe workflow through the shared template registry.",
    inputSchema: mcpInputSchema,
    typedErrors: ["Unauthorized", "ValidationFailed"],
  },
];

export const runTemplateWorkflow = (
  registry: TemplateRegistry = templateRegistry,
): WorkflowRunReceipt => createSampleWorkflowRunReceipt(registry);

const mcpText = (value: unknown): McpToolCallResult => ({
  isError: false,
  content: [
    {
      type: "text",
      text: JSON.stringify(value, null, 2),
    },
  ],
});

const mcpError = (message: string): McpToolCallResult => ({
  isError: true,
  content: [
    {
      type: "text",
      text: JSON.stringify(
        {
          ok: false,
          error: {
            _tag: "ToolNotFound",
            message,
          },
        },
        null,
        2,
      ),
    },
  ],
});

export const callMcpTool = (
  toolName: string,
  registry: TemplateRegistry = templateRegistry,
): McpToolCallResult => {
  if (toolName === "template.workflow.run") {
    return mcpText(runTemplateWorkflow(registry));
  }

  const capability = registry.capabilities.find(
    (candidate) => `template.${candidate.name}` === toolName,
  );

  if (!capability) {
    return mcpError(`Unknown MCP tool: ${toolName}`);
  }

  return mcpText({
    ok: true,
    toolName,
    capability: capability.name,
    policy: capability.policy,
    typedErrors: capability.typedErrors,
    result: {
      status: "accepted",
      source: "shared-template-registry",
    },
  });
};
