import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { continueAgentTurn, createAgentRuntime } from "./runtime";
import { sourceGroundedBriefTool } from "./defineTools";
import assistant, {
  AssistantError,
  verifyWorkspaceAccess,
} from "./assistant.spec";

const fakeMemberships = [
  {
    workspaceId: "workspace_123",
    userId: "user_123",
    status: "active",
  },
] as const;

const requireWorkspaceAccess = (input: {
  readonly workspaceId: string;
  readonly userId: string;
}) => {
  const access = verifyWorkspaceAccess({
    ...input,
    memberships: fakeMemberships,
  });

  return access.ok ? undefined : access.error;
};

const startThread = FunctionImpl.make(
  databaseSchema,
  assistant,
  "startThread",
  ({ workspaceId, userId, firstMessage }) => {
    const accessError = requireWorkspaceAccess({ workspaceId, userId });

    if (accessError) {
      return Effect.fail(accessError);
    }

    return Effect.succeed({
      threadId: `thread_${workspaceId}_${userId}`,
      messages: [
        {
          id: "msg_user_001",
          role: "user" as const,
          content: firstMessage,
          createdAt: 1,
        },
        {
          id: "msg_assistant_001",
          role: "assistant" as const,
          content:
            "I can use sourceGroundedBrief when the agent policy grants capability.run.",
          createdAt: 2,
        },
      ],
    });
  },
);

const continueThread = FunctionImpl.make(
  databaseSchema,
  assistant,
  "continueThread",
  ({ workspaceId, userId, threadId, message, idempotencyKey }) => {
    const accessError = requireWorkspaceAccess({ workspaceId, userId });

    if (accessError) {
      return Effect.fail(accessError);
    }

    return Effect.promise(async () => {
      const runtime = createAgentRuntime({
        workspaceId,
        policy: {
          allowedToolGrantIds: ["capability.run"],
          maxToolCalls: 2,
          modelRef: "openrouter:fake/local-demo",
        },
        tools: [sourceGroundedBriefTool],
      });
      const turn = await continueAgentTurn(runtime, {
        threadId,
        userMessage: message,
        requestedToolName: "sourceGroundedBrief",
        toolArgs: {
          workspaceId,
          sourceIds: ["source_1"],
          briefGoal: message,
          idempotencyKey,
        },
      });

      return {
        threadId,
        messages: [
          {
            id: "msg_user_continue",
            role: "user" as const,
            content: message,
            createdAt: 3,
          },
          {
            id: "msg_assistant_continue",
            role: "assistant" as const,
            content: turn.assistantMessage,
            createdAt: 4,
          },
        ],
        toolCallCount: turn.toolCalls.length,
      };
    }).pipe(
      Effect.mapError(
        () =>
          new AssistantError.ValidationFailed({
            field: "message",
            message: "Unable to continue assistant thread.",
          }),
      ),
    );
  },
);

const listThreadMessages = FunctionImpl.make(
  databaseSchema,
  assistant,
  "listThreadMessages",
  ({ workspaceId, userId, threadId }) => {
    const accessError = requireWorkspaceAccess({ workspaceId, userId });

    if (accessError) {
      return Effect.fail(accessError);
    }

    return Effect.succeed([
      {
        id: `${threadId}_summary`,
        role: "assistant" as const,
        content:
          "This fake/local assistant thread re-verifies workspace access before reading messages.",
        createdAt: 1,
      },
    ]);
  },
);

export default GroupImpl.make(databaseSchema, assistant).pipe(
  Layer.provide(startThread),
  Layer.provide(continueThread),
  Layer.provide(listThreadMessages),
  GroupImpl.finalize,
);
