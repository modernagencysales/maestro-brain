import {
  preparedSlackChunkDigest,
  preparedTranscriptChunkDigest,
  type PageChunkDescriptor,
} from "./providerReconciliation";
import type { PersistedSourceReconciliationPage } from "./sourceReconciliationRepository";
import type {
  PreparedSlackReconciliationPage,
  PreparedSlackReconciliationWrite,
} from "./slackReconciliationAdapter";
import type {
  PreparedTranscriptReconciliationPage,
  PreparedTranscriptReconciliationWrite,
} from "./transcriptReconciliationAdapter";

const MAX_PREPARED_PAGE_BYTES = 750_000;

type RunRef = Readonly<{
  reconciliationRunKey: string;
  expectedRunGeneration: number;
  expectedConnectionGeneration: number;
  expectedAllowlistGeneration: number;
  expectedLeaseGeneration: number;
  leaseId: string;
}>;

type PageRef = RunRef &
  Readonly<{
    cursorKey: string;
    expectedCursor: string | null;
    expectedCursorGeneration: number;
  }>;

type BeginPageBase = PageRef &
  Readonly<{
    nextCursor: string | null;
    traversalComplete: boolean;
    providerHighWater: string | null;
    ledgerHighWater: number;
    chunks: readonly PageChunkDescriptor[];
    now: number;
  }>;

export type SourceReconciliationPort = Readonly<{
  loadPage: (
    args: PageRef & { readonly sourceChunk: "slack" | "transcript" },
  ) => Promise<PersistedSourceReconciliationPage | null>;
  beginPage: (
    args:
      | (BeginPageBase & {
          readonly preparedSlackPage: PreparedSlackReconciliationPage;
        })
      | (BeginPageBase & {
          readonly preparedTranscriptPage: PreparedTranscriptReconciliationPage;
        }),
  ) => Promise<{
    readonly pageEnvelopeKey: string;
    readonly pageDigest: string;
    readonly totalChunkCount: number;
  }>;
  commitChunk: (
    args: RunRef & {
      readonly pageEnvelopeKey: string;
      readonly chunkIndex: number;
      readonly chunkDigest: string;
      readonly requiredScopeIntentKey: string;
      readonly observations: readonly [];
      readonly sourceChunk: "slack" | "transcript";
      readonly now: number;
    },
  ) => Promise<{
    readonly pageChunkKey: string;
    readonly observationCount: number;
    readonly seenCount: number;
    readonly obligationCount: number;
    readonly duplicate: boolean;
  }>;
  finalizePage: (
    args: RunRef & {
      readonly pageEnvelopeKey: string;
      readonly cursorKey: string;
      readonly now: number;
    },
  ) => Promise<{
    readonly providerCursor: string | null;
    readonly traversalComplete: boolean;
    readonly cursorGeneration: number;
    readonly ledgerHighWater: number;
  }>;
}>;

type ProviderPage<Write> = Readonly<{
  writes: readonly Write[];
  cursorAfter: string | null;
  terminal: boolean;
}>;

type CoordinateBase = PageRef &
  Readonly<{
    connectorScopeKey: string;
    requiredScopeIntentKey: string;
    providerHighWater: string | null;
    reconciliation: SourceReconciliationPort;
    now: number;
    chunkSize?: number;
    beforeReconciliationChunk?: (index: number) => void | Promise<void>;
    afterReconciliationChunk?: (
      receipt: SourceReconciliationChunkReceipt,
      index: number,
    ) => void | Promise<void>;
  }>;

export type SourceReconciliationInput =
  | (CoordinateBase & {
      readonly sourceChunk: "slack";
      readonly fetchPage: () => Promise<
        ProviderPage<PreparedSlackReconciliationWrite>
      >;
    })
  | (CoordinateBase & {
      readonly sourceChunk: "transcript";
      readonly fetchPage: () => Promise<
        ProviderPage<PreparedTranscriptReconciliationWrite>
      >;
    });

export type SourceReconciliationChunkReceipt = Awaited<
  ReturnType<SourceReconciliationPort["commitChunk"]>
>;

export type SourceReconciliationPageResult = Readonly<{
  sourceChunk: "slack" | "transcript";
  pageEnvelopeKey: string;
  pageDigest: string;
  observationCount: number;
  chunkReceipts: readonly SourceReconciliationChunkReceipt[];
  cursor: Readonly<{
    providerCursor: string | null;
    traversalComplete: boolean;
    cursorGeneration: number;
    ledgerHighWater: number;
  }>;
}>;

export class SourceReconciliationCoordinatorError extends Error {
  readonly _tag = "SourceReconciliationCoordinatorError";

  constructor(
    readonly reason:
      | "invalid_request"
      | "page_load_failed"
      | "provider_fetch_failed"
      | "page_begin_failed"
      | "before_chunk_commit_failed"
      | "chunk_commit_failed"
      | "after_chunk_commit_failed"
      | "page_finalize_failed",
    readonly retryable: boolean,
    readonly causeTag: string | null,
  ) {
    super(`Source reconciliation coordination failed: ${reason}`);
  }
}

const taggedCause = (error: unknown): string | null => {
  if (error === null || typeof error !== "object") return null;
  const tag = (error as { readonly _tag?: unknown })._tag;
  return typeof tag === "string" ? tag : null;
};

const coordinationError = (
  reason: SourceReconciliationCoordinatorError["reason"],
  error?: unknown,
) =>
  new SourceReconciliationCoordinatorError(
    reason,
    reason !== "invalid_request",
    taggedCause(error),
  );

const chunksOf = <Value>(
  values: readonly Value[],
  chunkSize: number,
): readonly (readonly Value[])[] => {
  if (values.length === 0) return [[]];
  const chunks: Value[][] = [];
  for (let index = 0; index < values.length; index += chunkSize)
    chunks.push(values.slice(index, index + chunkSize));
  return chunks;
};

const describeChunks = <Write>(
  writes: readonly Write[],
  chunkSize: number,
  digest: (chunk: readonly Write[]) => string,
) => {
  const chunks = chunksOf(writes, chunkSize);
  if (chunks.length > 64) throw coordinationError("invalid_request");
  return {
    chunks,
    descriptors: chunks.map((chunk, chunkIndex): PageChunkDescriptor => ({
      chunkIndex,
      chunkDigest: digest(chunk),
      observationCount: chunk.length,
    })),
  };
};

const assertPreparedPage = (
  persisted: PersistedSourceReconciliationPage,
  input: {
    readonly sourceChunk: "slack" | "transcript";
    readonly connectorScopeKey: string;
    readonly expectedCursor: string | null;
  },
) => {
  const page = persisted.preparedPage;
  const encodedBytes = new TextEncoder().encode(
    JSON.stringify(page),
  ).byteLength;
  const invalidChunks =
    persisted.sourceChunk === "slack"
      ? persisted.preparedPage.chunks.some(
          (chunk, index) =>
            preparedSlackChunkDigest(chunk) !==
              persisted.chunks[index]?.chunkDigest ||
            chunk.length !== persisted.chunks[index]?.observationCount,
        )
      : persisted.preparedPage.chunks.some(
          (chunk, index) =>
            preparedTranscriptChunkDigest(chunk) !==
              persisted.chunks[index]?.chunkDigest ||
            chunk.length !== persisted.chunks[index]?.observationCount,
        );
  if (
    persisted.sourceChunk !== input.sourceChunk ||
    page.connectorScopeKey !== input.connectorScopeKey ||
    page.cursorBefore !== input.expectedCursor ||
    page.chunks.length !== persisted.chunks.length ||
    encodedBytes > MAX_PREPARED_PAGE_BYTES ||
    invalidChunks
  )
    throw coordinationError("invalid_request");
};

export const coordinateSourceReconciliationPage = async (
  input: SourceReconciliationInput,
): Promise<SourceReconciliationPageResult> => {
  const chunkSize = input.chunkSize ?? 100;
  if (
    !Number.isSafeInteger(chunkSize) ||
    chunkSize < 1 ||
    chunkSize > 100 ||
    input.expectedCursorGeneration < 1 ||
    input.connectorScopeKey.trim().length === 0 ||
    input.cursorKey.trim().length === 0 ||
    input.requiredScopeIntentKey.trim().length === 0
  )
    throw coordinationError("invalid_request");

  const pageRef = {
    reconciliationRunKey: input.reconciliationRunKey,
    expectedRunGeneration: input.expectedRunGeneration,
    expectedConnectionGeneration: input.expectedConnectionGeneration,
    expectedAllowlistGeneration: input.expectedAllowlistGeneration,
    expectedLeaseGeneration: input.expectedLeaseGeneration,
    leaseId: input.leaseId,
    cursorKey: input.cursorKey,
    expectedCursor: input.expectedCursor,
    expectedCursorGeneration: input.expectedCursorGeneration,
  };
  let persisted: PersistedSourceReconciliationPage | null;
  try {
    persisted = await input.reconciliation.loadPage({
      ...pageRef,
      sourceChunk: input.sourceChunk,
    });
  } catch (error) {
    throw coordinationError("page_load_failed", error);
  }

  if (persisted === null) {
    if (input.sourceChunk === "slack") {
      let providerPage: ProviderPage<PreparedSlackReconciliationWrite>;
      try {
        providerPage = await input.fetchPage();
      } catch (error) {
        throw coordinationError("provider_fetch_failed", error);
      }
      const { chunks, descriptors } = describeChunks(
        providerPage.writes,
        chunkSize,
        preparedSlackChunkDigest,
      );
      const preparedPage: PreparedSlackReconciliationPage = {
        connectorScopeKey: input.connectorScopeKey,
        cursorBefore: input.expectedCursor,
        cursorAfter: providerPage.cursorAfter,
        terminal: providerPage.terminal,
        chunks,
      };
      let envelope: Awaited<ReturnType<SourceReconciliationPort["beginPage"]>>;
      try {
        envelope = await input.reconciliation.beginPage({
          ...pageRef,
          nextCursor: providerPage.cursorAfter,
          traversalComplete: providerPage.terminal,
          providerHighWater: input.providerHighWater,
          ledgerHighWater: 0,
          chunks: descriptors,
          preparedSlackPage: preparedPage,
          now: input.now,
        });
      } catch (error) {
        throw coordinationError("page_begin_failed", error);
      }
      persisted = {
        sourceChunk: "slack",
        pageEnvelopeKey: envelope.pageEnvelopeKey,
        pageDigest: envelope.pageDigest,
        ledgerHighWater: 0,
        chunks: descriptors,
        preparedPage,
      };
    } else {
      let providerPage: ProviderPage<PreparedTranscriptReconciliationWrite>;
      try {
        providerPage = await input.fetchPage();
      } catch (error) {
        throw coordinationError("provider_fetch_failed", error);
      }
      const { chunks, descriptors } = describeChunks(
        providerPage.writes,
        chunkSize,
        preparedTranscriptChunkDigest,
      );
      const preparedPage: PreparedTranscriptReconciliationPage = {
        connectorScopeKey: input.connectorScopeKey,
        cursorBefore: input.expectedCursor,
        cursorAfter: providerPage.cursorAfter,
        terminal: providerPage.terminal,
        chunks,
      };
      let envelope: Awaited<ReturnType<SourceReconciliationPort["beginPage"]>>;
      try {
        envelope = await input.reconciliation.beginPage({
          ...pageRef,
          nextCursor: providerPage.cursorAfter,
          traversalComplete: providerPage.terminal,
          providerHighWater: input.providerHighWater,
          ledgerHighWater: 0,
          chunks: descriptors,
          preparedTranscriptPage: preparedPage,
          now: input.now,
        });
      } catch (error) {
        throw coordinationError("page_begin_failed", error);
      }
      persisted = {
        sourceChunk: "transcript",
        pageEnvelopeKey: envelope.pageEnvelopeKey,
        pageDigest: envelope.pageDigest,
        ledgerHighWater: 0,
        chunks: descriptors,
        preparedPage,
      };
    }
  }

  assertPreparedPage(persisted, input);
  const chunkReceipts: SourceReconciliationChunkReceipt[] = [];
  for (const descriptor of persisted.chunks) {
    if (input.beforeReconciliationChunk !== undefined)
      try {
        await input.beforeReconciliationChunk(descriptor.chunkIndex);
      } catch (error) {
        throw coordinationError("before_chunk_commit_failed", error);
      }
    let receipt: SourceReconciliationChunkReceipt;
    try {
      receipt = await input.reconciliation.commitChunk({
        reconciliationRunKey: input.reconciliationRunKey,
        expectedRunGeneration: input.expectedRunGeneration,
        expectedConnectionGeneration: input.expectedConnectionGeneration,
        expectedAllowlistGeneration: input.expectedAllowlistGeneration,
        expectedLeaseGeneration: input.expectedLeaseGeneration,
        leaseId: input.leaseId,
        pageEnvelopeKey: persisted.pageEnvelopeKey,
        chunkIndex: descriptor.chunkIndex,
        chunkDigest: descriptor.chunkDigest,
        requiredScopeIntentKey: input.requiredScopeIntentKey,
        observations: [],
        sourceChunk: input.sourceChunk,
        now: input.now,
      });
    } catch (error) {
      throw coordinationError("chunk_commit_failed", error);
    }
    chunkReceipts.push(receipt);
    if (input.afterReconciliationChunk !== undefined)
      try {
        await input.afterReconciliationChunk(receipt, descriptor.chunkIndex);
      } catch (error) {
        throw coordinationError("after_chunk_commit_failed", error);
      }
  }
  let cursor: Awaited<ReturnType<SourceReconciliationPort["finalizePage"]>>;
  try {
    cursor = await input.reconciliation.finalizePage({
      reconciliationRunKey: input.reconciliationRunKey,
      expectedRunGeneration: input.expectedRunGeneration,
      expectedConnectionGeneration: input.expectedConnectionGeneration,
      expectedAllowlistGeneration: input.expectedAllowlistGeneration,
      expectedLeaseGeneration: input.expectedLeaseGeneration,
      leaseId: input.leaseId,
      pageEnvelopeKey: persisted.pageEnvelopeKey,
      cursorKey: input.cursorKey,
      now: input.now,
    });
  } catch (error) {
    throw coordinationError("page_finalize_failed", error);
  }
  return {
    sourceChunk: input.sourceChunk,
    pageEnvelopeKey: persisted.pageEnvelopeKey,
    pageDigest: persisted.pageDigest,
    observationCount: chunkReceipts.reduce(
      (count, receipt) => count + receipt.observationCount,
      0,
    ),
    chunkReceipts,
    cursor,
  };
};
