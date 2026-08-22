import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
import {
  StructuredOriginIntegrityFailure,
  StructuredQueryCapacityExceeded,
  StructuredQueryRejected,
} from "../integrations/structuredLedgerSchemas";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import {
  StructuredQueryArgs,
  StructuredQueryResult,
} from "./structuredQueryPlanner";

const Errors = Schema.Union(
  Unauthorized,
  Forbidden,
  ValidationFailed,
  StructuredQueryRejected,
  StructuredQueryCapacityExceeded,
  StructuredOriginIntegrityFailure,
);

export const query = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "query",
    args: () => StructuredQueryArgs,
    returns: () => StructuredQueryResult,
    error: () => Errors,
  }),
  {
    namespace: "brain.structured",
    name: "query",
    operationId: "brain.structured.query",
    kind: "query",
    surfaces: ["api", "mcp"],
    typedErrors: [
      "Unauthorized",
      "Forbidden",
      "ValidationFailed",
      "StructuredQueryRejected",
      "StructuredQueryCapacityExceeded",
      "StructuredOriginIntegrityFailure",
    ],
    idempotent: true,
    argsSchemaName: "brain.structured.query.args",
    returnsSchemaName: "brain.structured.query.returns",
    argsSchema: StructuredQueryArgs,
    returnsSchema: StructuredQueryResult,
  },
);

const functions = [query] as const;
export const manifest = collectContractManifest(functions);
export const schemaRegistry = collectContractSchemas(functions);

export default GroupSpec.make().addFunction(query.spec);
