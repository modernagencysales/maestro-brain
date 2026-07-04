import * as JSONSchema from "effect/JSONSchema";
import type * as Schema from "effect/Schema";

export type ContractFunctionKind = "query" | "mutation" | "action";
export type ContractSurface =
  "api" | "cli" | "mcp" | "web" | "workflow" | "internal";

export type ContractFunctionManifest = {
  readonly namespace: string;
  readonly name: string;
  readonly operationId: string;
  readonly kind: ContractFunctionKind;
  readonly surfaces: readonly ContractSurface[];
  readonly typedErrors: readonly string[];
  readonly idempotent: boolean;
  readonly argsSchemaName: string;
  readonly returnsSchemaName: string;
};

export type ContractManifest = {
  readonly version: 1;
  readonly generatedAt: string;
  readonly functions: readonly ContractFunctionManifest[];
};

export type ContractSchemaRegistry = Readonly<
  Record<string, Schema.Schema.Any>
>;

export type ContractJsonSchemas = {
  readonly openApi31: Readonly<Record<string, unknown>>;
  readonly mcp: Readonly<Record<string, unknown>>;
};

export const buildContractManifest = (
  functions: readonly ContractFunctionManifest[],
  generatedAt = "1970-01-01T00:00:00.000Z",
): ContractManifest => ({
  version: 1,
  generatedAt,
  functions: [...functions].sort((left, right) =>
    left.operationId.localeCompare(right.operationId),
  ),
});

export const manifestOperationIds = (
  manifest: ContractManifest,
): readonly string[] => manifest.functions.map((entry) => entry.operationId);

export const duplicateOperationIds = (
  functions: readonly ContractFunctionManifest[],
): readonly string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of functions) {
    if (seen.has(entry.operationId)) {
      duplicates.add(entry.operationId);
      continue;
    }

    seen.add(entry.operationId);
  }

  return [...duplicates].sort((left, right) => left.localeCompare(right));
};

export const mergeContractSchemaRegistries = (
  ...registries: readonly ContractSchemaRegistry[]
): ContractSchemaRegistry => Object.assign({}, ...registries);

export const buildContractJsonSchemas = (
  schemaRegistry: ContractSchemaRegistry,
): ContractJsonSchemas => {
  const registryEntries = Object.entries(schemaRegistry).sort(
    ([left], [right]) => left.localeCompare(right),
  );

  return {
    openApi31: Object.fromEntries(
      registryEntries.map(([name, schema]) => [
        name,
        JSONSchema.make(schema, { target: "openApi3.1" }),
      ]),
    ),
    mcp: Object.fromEntries(
      registryEntries.map(([name, schema]) => [
        name,
        JSONSchema.make(schema, { target: "jsonSchema2020-12" }),
      ]),
    ),
  };
};

export const missingSchemasForManifest = (
  manifest: ContractManifest,
  schemaRegistry: ContractSchemaRegistry,
): readonly string[] => {
  const missing = new Set<string>();

  for (const entry of manifest.functions) {
    if (!(entry.argsSchemaName in schemaRegistry)) {
      missing.add(entry.argsSchemaName);
    }

    if (!(entry.returnsSchemaName in schemaRegistry)) {
      missing.add(entry.returnsSchemaName);
    }
  }

  return [...missing].sort((left, right) => left.localeCompare(right));
};
