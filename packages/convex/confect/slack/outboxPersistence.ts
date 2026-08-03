import * as Either from "effect/Either";

import {
  answerOutboxRow,
  claimAnswerOutboxRow,
  completeAnswerDelivery,
  recordAnswerDeliveryFailure,
  recoverExpiredAnswerDelivery,
  type AnswerDeliveryInput,
  type AnswerDeliveryAuthorization,
  type AnswerLifecycleFence,
  type AnswerOutboxError,
  type SlackAnswerOutboxRow,
} from "./answerOutbox";

export type AnswerOutboxStore = {
  readonly insertIfAbsent: (
    row: SlackAnswerOutboxRow,
  ) => Promise<{
    readonly inserted: boolean;
    readonly row: SlackAnswerOutboxRow;
  }>;
  readonly claim: (
    answerKey: string,
    transition: (
      row: SlackAnswerOutboxRow,
    ) => Either.Either<SlackAnswerOutboxRow, AnswerOutboxError>,
  ) => Promise<Either.Either<SlackAnswerOutboxRow, AnswerOutboxError> | null>;
  readonly update: (
    answerKey: string,
    transition: (
      row: SlackAnswerOutboxRow,
    ) => Either.Either<SlackAnswerOutboxRow, AnswerOutboxError>,
  ) => Promise<Either.Either<SlackAnswerOutboxRow, AnswerOutboxError> | null>;
  readonly listExpiredInFlight: (
    now: number,
  ) => Promise<readonly SlackAnswerOutboxRow[]>;
};

export type PrivateAnswerProvider = {
  readonly send: (input: {
    readonly answerKey: string;
    readonly answer: SlackAnswerOutboxRow["answer"];
    readonly requesterSlackUserId: string;
    readonly channelId: string;
    readonly threadTs?: string;
  }) => Promise<
    | { readonly outcome: "delivered" }
    | { readonly outcome: "retryable"; readonly code?: string }
    | { readonly outcome: "ambiguous" }
  >;
};

export type EnqueueAnswerResult = {
  readonly inserted: boolean;
  readonly row: SlackAnswerOutboxRow;
};

export const enqueueAnswer = async (
  store: AnswerOutboxStore,
  input: {
    readonly input: AnswerDeliveryInput;
    readonly authorized: AnswerDeliveryAuthorization;
  },
): Promise<EnqueueAnswerResult> => {
  const result = await store.insertIfAbsent(answerOutboxRow(input));
  return result.inserted ? result : { inserted: true, row: result.row };
};

export type AnswerDeliveryResult =
  | { readonly outcome: "delivered" }
  | { readonly outcome: "denied" }
  | { readonly outcome: "ambiguous_no_retry" }
  | { readonly outcome: "retryable" }
  | { readonly outcome: "invalid" };

export const runAnswerDelivery = async (
  store: AnswerOutboxStore,
  input: {
    readonly answerKey: string;
    readonly expectedLifecycle: AnswerLifecycleFence;
    readonly leaseToken: string;
    readonly leaseExpiresAt: number;
    readonly now: number;
    readonly reauthorize: () => boolean | Promise<boolean>;
    readonly provider: PrivateAnswerProvider;
  },
): Promise<AnswerDeliveryResult> => {
  const claimed = await store.claim(input.answerKey, (row) =>
    claimAnswerOutboxRow(row, {
      expectedLifecycle: input.expectedLifecycle,
      leaseToken: input.leaseToken,
      leaseExpiresAt: input.leaseExpiresAt,
      now: input.now,
    }),
  );
  if (claimed === null || Either.isLeft(claimed)) return { outcome: "invalid" };
  const row = claimed.right;
  if (!(await input.reauthorize())) {
    await store.update(input.answerKey, (current) =>
      recordAnswerDeliveryFailure(current, {
        expectedLifecycle: input.expectedLifecycle,
        leaseToken: input.leaseToken,
        kind: "terminal",
        code: "final_reauthorization_denied",
        now: input.now,
      }),
    );
    return { outcome: "denied" };
  }
  let providerResult: Awaited<ReturnType<PrivateAnswerProvider["send"]>>;
  try {
    const send = input.provider.send({
      answerKey: row.answerKey,
      answer: row.answer,
      requesterSlackUserId: row.requester.slackUserId,
      channelId: row.delivery.externalChannelId,
    });
    const raced = await Promise.race([
      send,
      new Promise<{ readonly outcome: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ outcome: "timeout" }), 100);
      }),
    ]);
    if (raced.outcome === "timeout") return { outcome: "retryable" };
    providerResult = raced;
  } catch {
    providerResult = { outcome: "retryable", code: "provider_error" };
  }
  if (providerResult.outcome === "delivered") {
    const completed = await store.update(input.answerKey, (current) =>
      completeAnswerDelivery(current, {
        expectedLifecycle: input.expectedLifecycle,
        leaseToken: input.leaseToken,
        now: input.now,
      }),
    );
    return completed !== null && Either.isRight(completed)
      ? { outcome: "delivered" }
      : { outcome: "invalid" };
  }
  const ambiguous = providerResult.outcome === "ambiguous";
  const retryCode =
    providerResult.outcome === "retryable" ? providerResult.code : undefined;
  await store.update(input.answerKey, (current) =>
    recordAnswerDeliveryFailure(current, {
      expectedLifecycle: input.expectedLifecycle,
      leaseToken: input.leaseToken,
      kind: ambiguous ? "terminal" : "retryable",
      code: ambiguous
        ? "ambiguous_provider_outcome"
        : (retryCode ?? "provider_retryable"),
      now: input.now,
    }),
  );
  return ambiguous
    ? { outcome: "ambiguous_no_retry" }
    : { outcome: "retryable" };
};

export const recoverExpiredAnswers = async (
  store: AnswerOutboxStore,
  input: {
    readonly now: number;
    readonly expectedLifecycle: AnswerLifecycleFence;
  },
): Promise<readonly SlackAnswerOutboxRow[]> => {
  const expired = await store.listExpiredInFlight(input.now);
  const recovered: SlackAnswerOutboxRow[] = [];
  for (const row of expired) {
    const next = await store.update(row.answerKey, (current) =>
      recoverExpiredAnswerDelivery(current, input),
    );
    if (next !== null && Either.isRight(next)) recovered.push(next.right);
  }
  return recovered;
};
