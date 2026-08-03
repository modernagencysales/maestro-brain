import type { AskResponse } from "../brain/retrieval";
import type {
  AnswerDeliveryAuthorization,
  AnswerDeliveryInput,
} from "./answerOutbox";
import type { SlackScopedQuestion } from "./question";

type DeliveryInput = Omit<
  AnswerDeliveryInput,
  "requestId" | "answerReference" | "answerPayload"
>;

export type SlackQuestionOrchestrationDeps = Readonly<{
  readonly ask: (input: {
    readonly brainKey: string;
    readonly question: string;
  }) => Promise<AskResponse>;
  readonly enqueue: (
    input: AnswerDeliveryInput,
    authorized: AnswerDeliveryAuthorization,
  ) => Promise<Readonly<{ inserted: boolean; answerKey: string }>>;
}>;

export type SlackQuestionOrchestrationResult =
  | Readonly<{ outcome: "enqueued"; answerKey: string }>
  | Readonly<{
      outcome: "ignored";
      reason: "not_scoped" | "empty_question" | "scope_mismatch";
    }>;

const answerPayloadFor = (response: AskResponse) => ({
  format: "mrkdwn" as const,
  text:
    response.answer ??
    "I couldn't find enough published Brain evidence to answer that.",
  citations: response.evidence.map((evidence) => ({
    sourceKey: evidence.citationKey,
    label: evidence.title,
  })),
});

export const orchestrateSlackQuestion = async (
  input: Readonly<{
    readonly question: SlackScopedQuestion;
    readonly questionText: string;
    readonly delivery: DeliveryInput;
    readonly authorized: AnswerDeliveryAuthorization;
  }>,
  deps: SlackQuestionOrchestrationDeps,
): Promise<SlackQuestionOrchestrationResult> => {
  const question = input.question;
  if (
    question.state !== "scoped" ||
    question.scope === null ||
    question.receiptKey === undefined
  )
    return { outcome: "ignored", reason: "not_scoped" };
  const questionText = input.questionText.trim();
  if (!questionText) return { outcome: "ignored", reason: "empty_question" };
  if (
    input.delivery.organizationKey !== question.organizationKey ||
    input.delivery.workspaceId !== question.scope.workspaceId ||
    input.delivery.brainKey !== question.scope.brainKey
  )
    return { outcome: "ignored", reason: "scope_mismatch" };

  const response = await deps.ask({
    brainKey: question.scope.brainKey,
    question: questionText,
  });
  const queued = await deps.enqueue(
    {
      ...input.delivery,
      requestId: question.receiptKey,
      answerReference: `slack-ask:${question.receiptKey}`,
      answerPayload: answerPayloadFor(response),
    },
    input.authorized,
  );
  return { outcome: "enqueued", answerKey: queued.answerKey };
};
