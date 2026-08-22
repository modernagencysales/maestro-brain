import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
import { BrainNotFound, LifecycleRevoked } from "./pageTree";
import { FeedbackReportInput, FeedbackReportResult } from "./feedbackSchema";

const FeedbackErrors = Schema.Union(
  Unauthorized,
  Forbidden,
  BrainNotFound,
  LifecycleRevoked,
  ValidationFailed,
);

export const reportWrongOrStale = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "reportWrongOrStale",
    args: () => FeedbackReportInput,
    returns: () => FeedbackReportResult,
    error: () => FeedbackErrors,
  }),
  {
    namespace: "brain.feedback",
    name: "reportWrongOrStale",
    operationId: "brain.feedback.reportWrongOrStale",
    kind: "mutation",
    surfaces: ["api"],
    typedErrors: [
      "Unauthorized",
      "Forbidden",
      "BrainNotFound",
      "LifecycleRevoked",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "brain.feedback.reportWrongOrStale.args",
    returnsSchemaName: "brain.feedback.reportWrongOrStale.returns",
    argsSchema: FeedbackReportInput,
    returnsSchema: FeedbackReportResult,
  },
);

export const headlessReportWrongOrStale = FunctionSpec.internalMutation({
  name: "headlessReportWrongOrStale",
  args: () =>
    Schema.extend(
      FeedbackReportInput,
      Schema.Struct({
        organizationId: Id("organizations"),
        workspaceId: Id("workspaces"),
      }),
    ),
  returns: () => FeedbackReportResult,
  error: () => FeedbackErrors,
});

const functions = [reportWrongOrStale] as const;
export const manifest = collectContractManifest(functions);
export const schemaRegistry = collectContractSchemas(functions);

export default GroupSpec.make()
  .addFunction(reportWrongOrStale.spec)
  .addFunction(headlessReportWrongOrStale);
