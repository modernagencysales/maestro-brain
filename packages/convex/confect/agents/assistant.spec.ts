import { FunctionSpec, GroupSpec } from "@confect/core";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import { BrainEvidenceProvider } from "../tables/brainEvidenceSources";

export const StartThreadArgs = S.Struct({
  workspaceId: Id("workspaces"),
  firstMessage: S.String.pipe(S.check(S.isMinLength(1))),
});

export const ContinueThreadArgs = S.Struct({
  workspaceId: Id("workspaces"),
  threadId: S.String.pipe(S.check(S.isMinLength(1))),
  message: S.String.pipe(S.check(S.isMinLength(1))),
  idempotencyKey: S.String.pipe(S.check(S.isMinLength(1))),
});

export const ListThreadMessagesArgs = S.Struct({
  workspaceId: Id("workspaces"),
  threadId: S.String.pipe(S.check(S.isMinLength(1))),
});

export const AnswerQuestionArgs = S.Struct({
  workspaceId: Id("workspaces"),
  question: S.String.pipe(S.check(S.isMinLength(1))),
  maxCitations: S.optional(
    S.Number.pipe(
      S.check(S.isInt()),
      S.check(S.isGreaterThanOrEqualTo(1)),
      S.check(S.isLessThanOrEqualTo(10)),
    ),
  ),
});

const AnswerQuestionForActorArgs = S.Struct({
  ...AnswerQuestionArgs.fields,
  userId: Id("users"),
});

export const AnswerCitation = S.Struct({
  citationKey: S.String,
  sourceId: S.String,
  sourceRevisionId: S.String,
  provider: BrainEvidenceProvider,
  revisionKey: S.String,
  title: S.String,
  excerpt: S.String,
  startOffset: S.Number,
  endOffset: S.Number,
  contentHash: S.String,
  locator: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
  freshness: S.Literals(["current", "review-due", "stale"]),
});

export const ContextPackV3 = S.Struct({
  schemaVersion: S.Literal("3"),
  packHash: S.String,
  candidateManifest: S.Struct({
    schemaVersion: S.Literal("2"),
    candidateKeys: S.Array(S.String),
  }),
  workspaceId: Id("workspaces"),
  question: S.String,
  asOf: S.Number,
  freshness: S.Literals(["current", "review-due", "stale", "unknown"]),
  citations: S.Array(AnswerCitation),
  omissions: S.Array(
    S.Struct({
      reason: S.Literals(["archived", "revision-mismatch", "not-relevant"]),
      count: S.Number,
    }),
  ),
});

export const SaveEvaluationExampleArgs = S.Struct({
  workspaceId: Id("workspaces"),
  exampleKey: S.String,
  question: S.String,
  purpose: S.String,
  evidenceMode: S.Literals(["recent_evidence", "company_truth", "mixed"]),
  surface: S.Literals(["web", "cli", "api", "mcp"]),
  answerStatus: S.Literals(["answered", "insufficient-context"]),
  packHash: S.String,
  evidenceReferences: S.Array(
    S.Struct({
      sourceKey: S.String,
      revisionKey: S.String,
      contentHash: S.String,
    }),
  ),
  captureKind: S.Literals(["feedback", "test"]),
  usefulness: S.Literals(["useful", "needs-work", "unrated"]),
  issueReason: S.optional(
    S.Literals([
      "missing-source",
      "incorrect-answer",
      "stale-context",
      "citation-problem",
      "fallback-required",
      "other",
    ]),
  ),
});

const SaveEvaluationExampleForActorArgs = S.Struct({
  ...SaveEvaluationExampleArgs.fields,
  userId: Id("users"),
});

export const AnswerQuestionReturn = S.Union([
  S.Struct({
    status: S.Literal("answered"),
    answerMarkdown: S.String,
    contextPack: ContextPackV3,
  }),
  S.Struct({
    status: S.Literal("insufficient-context"),
    reason: S.Literal("no-eligible-evidence"),
    answerMarkdown: S.Null,
    contextPack: ContextPackV3,
  }),
]);

export const AssistantMessage = S.Struct({
  id: S.String,
  role: S.Literals(["user", "assistant", "tool"]),
  content: S.String,
  createdAt: S.Number,
});

export const StartThreadReturn = S.Struct({
  threadId: S.String,
  messages: S.Array(AssistantMessage),
});

export const ContinueThreadReturn = S.Struct({
  threadId: S.String,
  messages: S.Array(AssistantMessage),
  toolCallCount: S.Number,
});

export namespace AssistantError {
  export class Unauthenticated extends S.TaggedErrorClass<Unauthenticated>()(
    "Unauthenticated",
    {},
  ) {}

  export class NoWorkspaceAccess extends S.TaggedErrorClass<NoWorkspaceAccess>()(
    "NoWorkspaceAccess",
    {
      workspaceId: S.String,
      userId: S.String,
    },
  ) {}

  export class ThreadNotFound extends S.TaggedErrorClass<ThreadNotFound>()(
    "ThreadNotFound",
    {
      threadId: S.String,
    },
  ) {}

  export class ToolGrantDenied extends S.TaggedErrorClass<ToolGrantDenied>()(
    "ToolGrantDenied",
    {
      toolName: S.String,
      grantId: S.String,
    },
  ) {}

  export class ValidationFailed extends S.TaggedErrorClass<ValidationFailed>()(
    "ValidationFailed",
    {
      field: S.String,
      message: S.String,
    },
  ) {}

  export const Schema = S.Union([
    Unauthenticated,
    NoWorkspaceAccess,
    ThreadNotFound,
    ToolGrantDenied,
    ValidationFailed,
  ]);
}

export type WorkspaceMembership = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly status: "active" | "revoked" | "deleted";
};

export type VerifyWorkspaceAccessInput = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly memberships: readonly WorkspaceMembership[];
};

export type VerifyWorkspaceAccessResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: AssistantError.NoWorkspaceAccess;
    };

export const verifyWorkspaceAccess = (
  input: VerifyWorkspaceAccessInput,
): VerifyWorkspaceAccessResult => {
  const membership = input.memberships.find(
    (candidate) =>
      candidate.workspaceId === input.workspaceId &&
      candidate.userId === input.userId &&
      candidate.status === "active",
  );

  return membership
    ? { ok: true }
    : {
        ok: false,
        error: new AssistantError.NoWorkspaceAccess({
          workspaceId: input.workspaceId,
          userId: input.userId,
        }),
      };
};

const startThread = FunctionSpec.publicAction({
  name: "startThread",
  args: () => StartThreadArgs,
  returns: () => StartThreadReturn,
  error: () => AssistantError.Schema,
});

const continueThread = FunctionSpec.publicAction({
  name: "continueThread",
  args: () => ContinueThreadArgs,
  returns: () => ContinueThreadReturn,
  error: () => AssistantError.Schema,
});

const listThreadMessages = FunctionSpec.publicQuery({
  name: "listThreadMessages",
  args: () => ListThreadMessagesArgs,
  returns: () => S.Array(AssistantMessage),
  error: () => AssistantError.Schema,
});

const answerQuestion = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "answerQuestion",
    args: () => AnswerQuestionArgs,
    returns: () => AnswerQuestionReturn,
    error: () => AssistantError.Schema,
  }),
  {
    namespace: "agents.assistant",
    name: "answerQuestion",
    operationId: "agents.assistant.answerQuestion",
    kind: "query",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: ["Unauthenticated", "NoWorkspaceAccess", "ValidationFailed"],
    idempotent: true,
    argsSchemaName: "agents.assistant.answerQuestion.args",
    returnsSchemaName: "agents.assistant.answerQuestion.returns",
    argsSchema: AnswerQuestionArgs,
    returnsSchema: AnswerQuestionReturn,
  },
);

const saveEvaluationExample = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "saveEvaluationExample",
    args: () => SaveEvaluationExampleArgs,
    returns: () => Id("brainEvaluationExamples"),
    error: () => AssistantError.Schema,
  }),
  {
    namespace: "agents.assistant",
    name: "saveEvaluationExample",
    operationId: "agents.assistant.saveEvaluationExample",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: ["Unauthenticated", "NoWorkspaceAccess", "ValidationFailed"],
    idempotent: true,
    argsSchemaName: "agents.assistant.saveEvaluationExample.args",
    returnsSchemaName: "agents.assistant.saveEvaluationExample.returns",
    argsSchema: SaveEvaluationExampleArgs,
    returnsSchema: Id("brainEvaluationExamples"),
  },
);

const saveEvaluationExampleForActor = FunctionSpec.internalMutation({
  name: "saveEvaluationExampleForActor",
  args: () => SaveEvaluationExampleForActorArgs,
  returns: () => Id("brainEvaluationExamples"),
  error: () => AssistantError.Schema,
});

const answerQuestionForActor = FunctionSpec.internalQuery({
  name: "answerQuestionForActor",
  args: () => AnswerQuestionForActorArgs,
  returns: () => AnswerQuestionReturn,
  error: () => AssistantError.Schema,
});

const resolveAccess = FunctionSpec.internalQuery({
  name: "resolveAccess",
  args: () => S.Struct({ workspaceId: Id("workspaces") }),
  returns: () => S.Struct({ userId: Id("users") }),
  error: () => AssistantError.Schema,
});

export default GroupSpec.make()
  .addFunction(answerQuestion.spec)
  .addFunction(saveEvaluationExample.spec)
  .addFunction(answerQuestionForActor)
  .addFunction(saveEvaluationExampleForActor)
  .addFunction(startThread)
  .addFunction(continueThread)
  .addFunction(listThreadMessages)
  .addFunction(resolveAccess);

export const manifest = collectContractManifest([
  answerQuestion,
  saveEvaluationExample,
]);
export const schemaRegistry = collectContractSchemas([
  answerQuestion,
  saveEvaluationExample,
]);
