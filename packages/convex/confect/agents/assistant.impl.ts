import {
  Agent,
  extractText,
  getThreadMetadata,
  listMessages,
  type AgentComponent,
  type MessageDoc,
} from "@convex-dev/agent";
import { FunctionImpl, GroupImpl } from "@confect/server";
import { componentsGeneric } from "convex/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import databaseSchema from "../_generated/schema";
import refs from "../_generated/refs";
import {
  ActionCtx,
  DatabaseReader,
  DatabaseWriter,
  QueryCtx,
  QueryRunner,
} from "../_generated/services";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "../capabilities/_kit/workspaceAccess";
import { MAX_EVALUATION_EXAMPLES } from "../capabilities/manageBrainEvaluationExamples.domain";
import {
  MemberNotInWorkspace,
  Unauthorized,
  WorkspaceNotFound,
} from "../errors";
import { RuntimeModeConfig } from "../shared/config";
import { loadLlmGatewayEnvConfig } from "../shared/env";
import { assembleCompanyBrainContext } from "../capabilities/askCompanyBrain.impl";
import assistant, {
  AssistantError,
  SaveEvaluationExampleArgs,
} from "./assistant.spec";
import { createAssistantLanguageModel } from "./assistantModel";

const agentComponent = componentsGeneric().agent as unknown as AgentComponent;

const withConfectClock = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const assistantAccess = (
  workspaceId: Parameters<typeof requireWorkspaceAccess>[0],
) =>
  withConfectClock(requireWorkspaceAccess(workspaceId, "viewer")).pipe(
    Effect.mapError((error) => {
      if (error instanceof Unauthorized) {
        return new AssistantError.Unauthenticated();
      }
      if (
        error instanceof MemberNotInWorkspace ||
        error instanceof WorkspaceNotFound
      ) {
        return new AssistantError.NoWorkspaceAccess({
          workspaceId,
          userId: "authenticated-user",
        });
      }
      return new AssistantError.Unauthenticated();
    }),
  );

const assistantActorAccess = (
  workspaceId: Parameters<typeof requireWorkspaceActorAccess>[0],
  userId: Parameters<typeof requireWorkspaceActorAccess>[1],
) =>
  withConfectClock(
    requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
  ).pipe(
    Effect.mapError((error) => {
      if (error instanceof Unauthorized) {
        return new AssistantError.Unauthenticated();
      }
      return new AssistantError.NoWorkspaceAccess({
        workspaceId,
        userId,
      });
    }),
  );

const threadOwnerKey = (workspaceId: string, userId: string) =>
  `workspace:${workspaceId}:user:${userId}`;

const resolveAgent = Effect.gen(function* () {
  const mode = yield* RuntimeModeConfig.pipe(Effect.orDie);
  const env = yield* loadLlmGatewayEnvConfig.pipe(Effect.orDie);
  const languageModel = yield* Effect.try({
    try: () => createAssistantLanguageModel({ mode, env }),
    catch: providerUnavailable,
  });

  return new Agent(agentComponent, {
    name: "Maestro Assistant",
    languageModel,
    instructions:
      "Help the user understand and act on their workspace context. Be concise and do not invent sources.",
  });
});

const projectMessage = (message: MessageDoc) => {
  const role = message.message?.role;
  if (role !== "user" && role !== "assistant" && role !== "tool") return null;
  return {
    id: message._id,
    role,
    content:
      (message.message === undefined
        ? undefined
        : extractText(message.message)) ??
      message.text ??
      "",
    createdAt: message._creationTime,
  };
};

const readThreadMessages = async (
  ctx: Parameters<typeof listMessages>[0],
  threadId: string,
) => {
  const result = await listMessages(ctx, agentComponent, {
    threadId,
    paginationOpts: { numItems: 100, cursor: null },
  });
  return result.page.flatMap((message) => {
    const projected = projectMessage(message);
    return projected === null ? [] : [projected];
  });
};

const readThreadOwner = async (
  ctx: Parameters<typeof getThreadMetadata>[0],
  threadId: string,
) => {
  const metadata = await getThreadMetadata(ctx, agentComponent, { threadId });
  return metadata.userId;
};

const providerUnavailable = () =>
  new AssistantError.ValidationFailed({
    field: "provider",
    message: "Assistant provider is unavailable.",
  });

const resolveAccess = FunctionImpl.make(
  databaseSchema,
  assistant,
  "resolveAccess",
  ({ workspaceId }) =>
    assistantAccess(workspaceId).pipe(Effect.map(({ userId }) => ({ userId }))),
);

const answerGroundedQuestion = (input: {
  readonly workspaceId: Parameters<typeof assistantAccess>[0];
  readonly question: string;
  readonly maxCitations?: number | undefined;
}) =>
  assembleCompanyBrainContext({
    ...input,
    evidenceMode: "recent_evidence",
  }).pipe(
    Effect.map((result) => {
      const citations = result.contextPack.citations.map((citation) => ({
        citationKey: citation.citationKey,
        sourceId: citation.sourceKey,
        sourceRevisionId: `${citation.sourceKey}:revision:${citation.revisionKey}`,
        provider: citation.provider,
        revisionKey: citation.revisionKey,
        title: citation.title,
        excerpt: citation.excerpt,
        startOffset: citation.startOffset,
        endOffset: citation.endOffset,
        contentHash: citation.contentHash,
        ...(citation.locator === undefined
          ? {}
          : { locator: citation.locator }),
        sourceModifiedAt: citation.sourceModifiedAt,
        observedAt: citation.observedAt,
        freshness: citation.freshness,
      }));
      const contextPack = {
        schemaVersion: "3" as const,
        packHash: result.contextPack.packHash,
        candidateManifest: {
          schemaVersion: "2" as const,
          candidateKeys: citations.map(
            ({ sourceRevisionId }) => sourceRevisionId,
          ),
        },
        workspaceId: result.contextPack.workspaceId,
        question: result.contextPack.question,
        asOf: result.contextPack.asOf,
        freshness: result.contextPack.freshness,
        citations,
        omissions: result.contextPack.omissions.flatMap(({ reason, count }) =>
          reason === "archived" ||
          reason === "revision-mismatch" ||
          reason === "not-relevant"
            ? [{ reason, count }]
            : [],
        ),
      };
      return result.status === "answered"
        ? {
            status: "answered" as const,
            answerMarkdown: result.answerMarkdown,
            contextPack,
          }
        : {
            status: "insufficient-context" as const,
            reason: "no-eligible-evidence" as const,
            answerMarkdown: null,
            contextPack,
          };
    }),
    Effect.mapError(
      (error) =>
        new AssistantError.ValidationFailed({
          field: "question",
          message:
            "message" in error && typeof error.message === "string"
              ? error.message
              : "Company Brain context could not be assembled.",
        }),
    ),
  );

const answerQuestion = FunctionImpl.make(
  databaseSchema,
  assistant,
  "answerQuestion",
  (args) =>
    Effect.gen(function* () {
      yield* assistantAccess(args.workspaceId);
      return yield* answerGroundedQuestion(args);
    }),
);

const answerQuestionForActor = FunctionImpl.make(
  databaseSchema,
  assistant,
  "answerQuestionForActor",
  ({ userId, ...args }) =>
    Effect.gen(function* () {
      yield* assistantActorAccess(args.workspaceId, userId);
      return yield* answerGroundedQuestion(args);
    }),
);

type SaveEvaluationExampleInput = Schema.Schema.Type<
  typeof SaveEvaluationExampleArgs
>;

const persistEvaluationExample = (
  args: SaveEvaluationExampleInput,
  actorUserId: GenericId<"users">,
) =>
  Effect.gen(function* () {
    const exampleKey = args.exampleKey.trim();
    const question = args.question.trim();
    const purpose = args.purpose.trim();
    if (exampleKey.length === 0 || exampleKey.length > 200)
      return yield* new AssistantError.ValidationFailed({
        field: "exampleKey",
        message: "Example key must contain between 1 and 200 characters.",
      });
    if (question.length === 0 || question.length > 2_000)
      return yield* new AssistantError.ValidationFailed({
        field: "question",
        message: "Question must contain between 1 and 2000 characters.",
      });
    if (purpose.length === 0 || purpose.length > 120)
      return yield* new AssistantError.ValidationFailed({
        field: "purpose",
        message: "Purpose must contain between 1 and 120 characters.",
      });
    if (!/^sha256:[a-f0-9]{64}$/u.test(args.packHash))
      return yield* new AssistantError.ValidationFailed({
        field: "packHash",
        message: "Pack hash must be a canonical SHA-256 identifier.",
      });
    if (
      args.maxCitations !== undefined &&
      (!Number.isInteger(args.maxCitations) ||
        args.maxCitations < 1 ||
        args.maxCitations > 10)
    )
      return yield* new AssistantError.ValidationFailed({
        field: "maxCitations",
        message: "Maximum citations must be between 1 and 10.",
      });
    if (
      args.capturedAsOf !== undefined &&
      (!Number.isFinite(args.capturedAsOf) || args.capturedAsOf < 0)
    )
      return yield* new AssistantError.ValidationFailed({
        field: "capturedAsOf",
        message: "Captured as-of must be a non-negative timestamp.",
      });
    if (
      args.policyVersion !== undefined &&
      (args.policyVersion.trim().length === 0 ||
        args.policyVersion.length > 120)
    )
      return yield* new AssistantError.ValidationFailed({
        field: "policyVersion",
        message: "Policy version must contain between 1 and 120 characters.",
      });
    if (args.evidenceReferences.length > 10)
      return yield* new AssistantError.ValidationFailed({
        field: "evidenceReferences",
        message: "At most 10 evidence references may be saved.",
      });
    if (
      args.answerStatus === "answered" &&
      args.evidenceReferences.length === 0
    )
      return yield* new AssistantError.ValidationFailed({
        field: "evidenceReferences",
        message: "Answered examples require at least one evidence reference.",
      });
    if (args.usefulness === "needs-work" && args.issueReason === undefined)
      return yield* new AssistantError.ValidationFailed({
        field: "issueReason",
        message: "Needs-work feedback requires an issue reason.",
      });

    const referenceKeys = new Set<string>();
    const reader = yield* DatabaseReader;
    for (const reference of args.evidenceReferences) {
      if (
        reference.sourceKey.length === 0 ||
        reference.sourceKey.length > 1_000 ||
        reference.revisionKey.length === 0 ||
        reference.revisionKey.length > 1_000 ||
        reference.contentHash.length === 0 ||
        reference.contentHash.length > 200
      )
        return yield* new AssistantError.ValidationFailed({
          field: "evidenceReferences",
          message: "Evidence reference fields exceed their bounded size.",
        });
      const referenceKey = `${reference.sourceKey}\u0000${reference.revisionKey}`;
      if (referenceKeys.has(referenceKey))
        return yield* new AssistantError.ValidationFailed({
          field: "evidenceReferences",
          message: "Evidence references must be unique.",
        });
      referenceKeys.add(referenceKey);
      const revisions = yield* reader
        .table("brainEvidenceRevisions")
        .index("by_workspace_and_source_key_and_revision_key", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("sourceKey", reference.sourceKey)
            .eq("revisionKey", reference.revisionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (
        revisions.length !== 1 ||
        revisions[0]?.contentHash !== reference.contentHash
      )
        return yield* new AssistantError.ValidationFailed({
          field: "evidenceReferences",
          message: "An evidence reference could not be reopened exactly.",
        });
    }

    const proposed = {
      workspaceId: args.workspaceId,
      exampleKey,
      question,
      purpose,
      evidenceMode: args.evidenceMode,
      surface: args.surface,
      answerStatus: args.answerStatus,
      packHash: args.packHash,
      ...(args.maxCitations === undefined
        ? {}
        : { maxCitations: args.maxCitations }),
      ...(args.capturedAsOf === undefined
        ? {}
        : { capturedAsOf: args.capturedAsOf }),
      ...(args.policyVersion === undefined
        ? {}
        : { policyVersion: args.policyVersion.trim() }),
      evidenceReferences: [...args.evidenceReferences],
      captureKind: args.captureKind,
      usefulness: args.usefulness,
      ...(args.issueReason === undefined
        ? {}
        : { issueReason: args.issueReason }),
      actorUserId,
    };
    const matches = yield* reader
      .table("brainEvaluationExamples")
      .index("by_workspace_and_example_key", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("exampleKey", exampleKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const existing = matches[0];
    if (existing !== undefined) {
      const existingPayload = {
        workspaceId: existing.workspaceId,
        exampleKey: existing.exampleKey,
        question: existing.question,
        purpose: existing.purpose,
        evidenceMode: existing.evidenceMode,
        surface: existing.surface,
        answerStatus: existing.answerStatus,
        packHash: existing.packHash,
        ...(existing.maxCitations === undefined
          ? {}
          : { maxCitations: existing.maxCitations }),
        ...(existing.capturedAsOf === undefined
          ? {}
          : { capturedAsOf: existing.capturedAsOf }),
        ...(existing.policyVersion === undefined
          ? {}
          : { policyVersion: existing.policyVersion }),
        evidenceReferences: existing.evidenceReferences,
        captureKind: existing.captureKind,
        usefulness: existing.usefulness,
        ...(existing.issueReason === undefined
          ? {}
          : { issueReason: existing.issueReason }),
        actorUserId: existing.actorUserId,
      };
      if (JSON.stringify(existingPayload) !== JSON.stringify(proposed))
        return yield* new AssistantError.ValidationFailed({
          field: "exampleKey",
          message: "Example key was already used for different input.",
        });
      return existing._id;
    }
    const capacity = yield* reader
      .table("brainEvaluationExamples")
      .index("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(MAX_EVALUATION_EXAMPLES)
      .pipe(Effect.orDie);
    if (capacity.length >= MAX_EVALUATION_EXAMPLES)
      return yield* new AssistantError.ValidationFailed({
        field: "workspaceId",
        message: `Evaluation examples are limited to ${MAX_EVALUATION_EXAMPLES} rows per workspace.`,
      });
    const now = yield* withConfectClock(Clock.currentTimeMillis);
    const writer = yield* DatabaseWriter;
    return yield* writer
      .table("brainEvaluationExamples")
      .insert({
        ...proposed,
        split: "development",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
  });

const saveEvaluationExample = FunctionImpl.make(
  databaseSchema,
  assistant,
  "saveEvaluationExample",
  (args) =>
    Effect.gen(function* () {
      const access = yield* assistantAccess(args.workspaceId);
      return yield* persistEvaluationExample(args, access.userId);
    }),
);

const saveEvaluationExampleForActor = FunctionImpl.make(
  databaseSchema,
  assistant,
  "saveEvaluationExampleForActor",
  ({ userId, ...args }) =>
    Effect.gen(function* () {
      yield* assistantActorAccess(args.workspaceId, userId);
      return yield* persistEvaluationExample(args, userId);
    }),
);

const resolveActionAccess = (
  workspaceId: Parameters<typeof assistantAccess>[0],
) =>
  Effect.gen(function* () {
    const query = yield* QueryRunner;
    return yield* query(refs.internal.agents.assistant.resolveAccess, {
      workspaceId,
    }).pipe(Effect.catchTag("SchemaError", () => providerUnavailable()));
  });

const startThread = FunctionImpl.make(
  databaseSchema,
  assistant,
  "startThread",
  ({ workspaceId, firstMessage }) =>
    Effect.gen(function* () {
      const access = yield* resolveActionAccess(workspaceId);
      const ctx = yield* ActionCtx;
      const runtime = yield* resolveAgent.pipe(
        Effect.mapError(providerUnavailable),
      );
      const ownerKey = threadOwnerKey(workspaceId, access.userId);
      return yield* Effect.tryPromise({
        try: async () => {
          const { threadId } = await runtime.createThread(ctx, {
            userId: ownerKey,
            title: firstMessage.slice(0, 80),
          });
          await runtime.generateText(
            ctx,
            { threadId, userId: ownerKey },
            { prompt: firstMessage },
          );
          return {
            threadId,
            messages: await readThreadMessages(ctx, threadId),
          };
        },
        catch: (error) =>
          error instanceof AssistantError.ThreadNotFound
            ? error
            : new AssistantError.ValidationFailed({
                field: "message",
                message: "Unable to start assistant thread.",
              }),
      });
    }),
);

const continueThread = FunctionImpl.make(
  databaseSchema,
  assistant,
  "continueThread",
  ({ workspaceId, threadId, message }) =>
    Effect.gen(function* () {
      const access = yield* resolveActionAccess(workspaceId);
      const ctx = yield* ActionCtx;
      const runtime = yield* resolveAgent.pipe(
        Effect.mapError(providerUnavailable),
      );
      const ownerKey = threadOwnerKey(workspaceId, access.userId);
      const storedOwner = yield* Effect.tryPromise({
        try: () => readThreadOwner(ctx, threadId),
        catch: () => new AssistantError.ThreadNotFound({ threadId }),
      });
      if (storedOwner !== ownerKey) {
        return yield* new AssistantError.ThreadNotFound({ threadId });
      }
      return yield* Effect.tryPromise({
        try: async () => {
          await runtime.generateText(
            ctx,
            { threadId, userId: ownerKey },
            { prompt: message },
          );
          return {
            threadId,
            messages: await readThreadMessages(ctx, threadId),
            toolCallCount: 0,
          };
        },
        catch: (error) =>
          error instanceof AssistantError.ThreadNotFound
            ? error
            : new AssistantError.ValidationFailed({
                field: "message",
                message: "Unable to continue assistant thread.",
              }),
      });
    }),
);

const listThreadMessages = FunctionImpl.make(
  databaseSchema,
  assistant,
  "listThreadMessages",
  ({ workspaceId, threadId }) =>
    Effect.gen(function* () {
      const access = yield* assistantAccess(workspaceId);
      const ctx = yield* QueryCtx;
      const ownerKey = threadOwnerKey(workspaceId, access.userId);
      const storedOwner = yield* Effect.tryPromise({
        try: () => readThreadOwner(ctx, threadId),
        catch: () => new AssistantError.ThreadNotFound({ threadId }),
      });
      if (storedOwner !== ownerKey) {
        return yield* new AssistantError.ThreadNotFound({ threadId });
      }
      return yield* Effect.tryPromise({
        try: async () => {
          return await readThreadMessages(ctx, threadId);
        },
        catch: (error) =>
          error instanceof AssistantError.ThreadNotFound
            ? error
            : new AssistantError.ThreadNotFound({ threadId }),
      });
    }),
);

export default GroupImpl.make(databaseSchema, assistant).pipe(
  Layer.provide(answerQuestion),
  Layer.provide(answerQuestionForActor),
  Layer.provide(saveEvaluationExample),
  Layer.provide(saveEvaluationExampleForActor),
  Layer.provide(startThread),
  Layer.provide(continueThread),
  Layer.provide(listThreadMessages),
  Layer.provide(resolveAccess),
  GroupImpl.finalize,
);
