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
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import refs from "../_generated/refs";
import { ActionCtx, QueryCtx, QueryRunner } from "../_generated/services";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "../capabilities/_kit/workspaceAccess";
import {
  MemberNotInWorkspace,
  Unauthorized,
  WorkspaceNotFound,
} from "../errors";
import { RuntimeModeConfig } from "../shared/config";
import { loadLlmGatewayEnvConfig } from "../shared/env";
import { searchEvidence } from "../brain/evidence.impl";
import assistant, { AssistantError } from "./assistant.spec";
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
  Effect.gen(function* () {
    const normalizedQuestion = input.question.trim();
    if (normalizedQuestion.length === 0)
      return yield* new AssistantError.ValidationFailed({
        field: "question",
        message: "Question must not be blank.",
      });
    const now = yield* withConfectClock(Clock.currentTimeMillis);
    const citations = yield* searchEvidence({
      workspaceId: input.workspaceId,
      query: normalizedQuestion,
      asOf: now,
      relevanceMode: "grounded",
      ...(input.maxCitations === undefined
        ? {}
        : { limit: input.maxCitations }),
    });
    const projectedCitations = citations.map((citation) => ({
      citationKey: `citation:${citation.entryKey}`,
      sourceId: citation.sourceKey,
      sourceRevisionId: citation.entryKey,
      provider: citation.provider,
      revisionKey: citation.revisionKey,
      title: citation.title,
      excerpt: citation.excerpt,
      startOffset: citation.startOffset,
      endOffset: citation.endOffset,
      contentHash: citation.contentHash,
      ...(citation.locator === undefined ? {} : { locator: citation.locator }),
      sourceModifiedAt: citation.sourceModifiedAt,
      observedAt: citation.observedAt,
      freshness: citation.freshness,
    }));
    const freshness = projectedCitations.some(
      (citation) => citation.freshness === "stale",
    )
      ? ("stale" as const)
      : projectedCitations.some(
            (citation) => citation.freshness === "review-due",
          )
        ? ("review-due" as const)
        : projectedCitations.length > 0
          ? ("current" as const)
          : ("unknown" as const);
    const contextPack = {
      schemaVersion: "3" as const,
      candidateManifest: {
        schemaVersion: "2" as const,
        candidateKeys: projectedCitations.map(
          ({ sourceRevisionId }) => sourceRevisionId,
        ),
      },
      workspaceId: input.workspaceId,
      question: normalizedQuestion,
      asOf: now,
      freshness,
      citations: projectedCitations,
      omissions: [],
    };

    return projectedCitations.length > 0
      ? {
          status: "answered" as const,
          answerMarkdown: projectedCitations
            .map(({ excerpt }, index) => `${excerpt} [${index + 1}]`)
            .join("\n\n"),
          contextPack,
        }
      : {
          status: "insufficient-context" as const,
          reason: "no-eligible-evidence" as const,
          answerMarkdown: null,
          contextPack,
        };
  });

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
  Layer.provide(startThread),
  Layer.provide(continueThread),
  Layer.provide(listThreadMessages),
  Layer.provide(resolveAccess),
  GroupImpl.finalize,
);
