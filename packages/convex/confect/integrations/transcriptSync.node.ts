"use node";

import type { NangoClient } from "@maestro-template/integrations/nango/client";
import type { CanonicalCallTranscript } from "@maestro-template/integrations/transcripts/canonical";
import {
  FirefliesDecodeError,
  normalizeFirefliesCall,
} from "@maestro-template/integrations/transcripts/fireflies";
import {
  GongDecodeError,
  normalizeGongCall,
} from "@maestro-template/integrations/transcripts/gong";
import {
  decodeFathomMeetingPage,
  FathomDecodeError,
  fathomMeetingsEndpoint,
  normalizeFathomCall,
} from "@maestro-template/integrations/transcripts/fathom";
import {
  decodeGranolaNotePage,
  GranolaDecodeError,
  granolaNotesEndpoint,
  normalizeGranolaNote,
} from "@maestro-template/integrations/transcripts/granola";

import type { TranscriptSyncErrorTag } from "./transcriptSync.impl";

export type TranscriptSyncSnapshot = {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly provider: "fireflies" | "gong" | "fathom" | "granola";
  readonly providerConfigKey: string;
  readonly nangoConnectionId: string;
  readonly cursor: string | null;
  readonly leaseId: string;
};

export type TranscriptSyncProvider = {
  readonly listPage: (snapshot: TranscriptSyncSnapshot) => Promise<{
    readonly records: readonly Record<string, unknown>[];
    readonly nextCursor: string | null;
  }>;
  readonly normalize: (
    snapshot: TranscriptSyncSnapshot,
    record: unknown,
  ) => Promise<CanonicalCallTranscript>;
};

export class TranscriptProviderRateLimited extends Error {
  readonly _tag = "TranscriptProviderRateLimited";
  constructor(readonly retryAfterMs: number) {
    super("Transcript provider rate limited the sync");
  }
}

export class TranscriptDecodeFailure extends Error {
  readonly _tag = "TranscriptDecodeFailure";
  constructor() {
    super("Transcript provider record could not be decoded");
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const nangoDeleted = (record: Record<string, unknown>): boolean => {
  const metadata = object(record._nango_metadata);
  return (
    record.deleted === true ||
    (typeof metadata?.deleted_at === "string" &&
      metadata.deleted_at.trim().length > 0) ||
    metadata?.last_action === "DELETED"
  );
};
const retryAfterMs = (value: string | undefined, now = Date.now()): number => {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 60_000;
};
const assertProxySuccess = (response: {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
}) => {
  if (response.status === 429)
    throw new TranscriptProviderRateLimited(
      retryAfterMs(response.headers?.["retry-after"]),
    );
  if (response.status < 200 || response.status >= 300)
    throw new Error("Transcript provider request failed");
};

export const createNangoTranscriptSyncProvider = (
  clientFor: (providerConfigKey: string) => NangoClient,
): TranscriptSyncProvider => ({
  listPage: async (snapshot) => {
    const client = clientFor(snapshot.providerConfigKey);
    if (snapshot.provider === "fireflies" || snapshot.provider === "gong")
      return client.listRecords({
        connectionId: snapshot.nangoConnectionId,
        providerConfigKey: snapshot.providerConfigKey,
        model:
          snapshot.provider === "fireflies" ? "Transcript" : "CallTranscript",
        ...(snapshot.cursor === null ? {} : { cursor: snapshot.cursor }),
        limit: 100,
      });
    const response = await client.proxy({
      connectionId: snapshot.nangoConnectionId,
      endpoint:
        snapshot.provider === "fathom"
          ? fathomMeetingsEndpoint(snapshot.cursor)
          : granolaNotesEndpoint(snapshot.cursor),
      method: "GET",
    });
    assertProxySuccess(response);
    try {
      return snapshot.provider === "fathom"
        ? decodeFathomMeetingPage(response.data)
        : decodeGranolaNotePage(response.data);
    } catch (error) {
      if (
        error instanceof FathomDecodeError ||
        error instanceof GranolaDecodeError
      )
        throw new TranscriptDecodeFailure();
      throw error;
    }
  },
  normalize: async (snapshot, record) => {
    const client = clientFor(snapshot.providerConfigKey);
    try {
      if (snapshot.provider === "fireflies") {
        const transcript = object(record);
        if (transcript && nangoDeleted(transcript))
          return normalizeFirefliesCall({
            connectionKey: snapshot.connectionKey,
            transcript,
            sentences: [],
          });
        const transcriptId =
          typeof transcript?.id === "string" ? transcript.id : "";
        if (!transcriptId) throw new TranscriptDecodeFailure();
        const response = await client.proxy({
          connectionId: snapshot.nangoConnectionId,
          endpoint: "/graphql",
          method: "POST",
          data: {
            query:
              "query MaestroTranscript($transcriptId: String!) { transcript(id: $transcriptId) { sentences { id transcript_id index speaker_name speaker_id raw_text text start_time end_time } } }",
            variables: { transcriptId },
          },
        });
        assertProxySuccess(response);
        const data = object(response.data);
        const graph = object(data?.data);
        const detail = object(graph?.transcript);
        if (!Array.isArray(detail?.sentences))
          throw new TranscriptDecodeFailure();
        return normalizeFirefliesCall({
          connectionKey: snapshot.connectionKey,
          transcript,
          sentences: detail.sentences,
        });
      }
      if (snapshot.provider === "gong") {
        const transcript = object(record);
        const callId =
          typeof transcript?.callId === "string" ? transcript.callId : "";
        if (!callId) throw new TranscriptDecodeFailure();
        const response = await client.proxy({
          connectionId: snapshot.nangoConnectionId,
          endpoint: "/v2/calls/extensive",
          method: "POST",
          data: {
            filter: { callIds: [callId] },
            contentSelector: {
              exposedFields: {
                parties: true,
                content: { media: true },
              },
            },
          },
        });
        assertProxySuccess(response);
        const data = object(response.data);
        const call = Array.isArray(data?.calls) ? data.calls[0] : undefined;
        if (!object(call)) throw new TranscriptDecodeFailure();
        return normalizeGongCall({
          connectionKey: snapshot.connectionKey,
          call,
          transcript,
        });
      }
      if (snapshot.provider === "fathom") {
        const meeting = object(record);
        if (meeting && nangoDeleted(meeting))
          return normalizeFathomCall({
            connectionKey: snapshot.connectionKey,
            meeting,
            transcript: {},
          });
        const recordingId = meeting?.recording_id;
        const id =
          typeof recordingId === "number" || typeof recordingId === "string"
            ? String(recordingId)
            : "";
        if (!id) throw new TranscriptDecodeFailure();
        const response = await client.proxy({
          connectionId: snapshot.nangoConnectionId,
          endpoint: `/external/v1/recordings/${encodeURIComponent(id)}/transcript`,
          method: "GET",
        });
        assertProxySuccess(response);
        return normalizeFathomCall({
          connectionKey: snapshot.connectionKey,
          meeting,
          transcript: response.data,
        });
      }
      if (snapshot.provider === "granola") {
        const summary = object(record);
        if (summary && nangoDeleted(summary))
          return normalizeGranolaNote({
            connectionKey: snapshot.connectionKey,
            note: summary,
          });
        const noteId = typeof summary?.id === "string" ? summary.id : "";
        if (!noteId) throw new TranscriptDecodeFailure();
        const response = await client.proxy({
          connectionId: snapshot.nangoConnectionId,
          endpoint: `/v1/notes/${encodeURIComponent(noteId)}?include=transcript`,
          method: "GET",
        });
        assertProxySuccess(response);
        return normalizeGranolaNote({
          connectionKey: snapshot.connectionKey,
          note: response.data,
        });
      }
      throw new TranscriptDecodeFailure();
    } catch (error) {
      if (
        error instanceof TranscriptProviderRateLimited ||
        error instanceof TranscriptDecodeFailure
      )
        throw error;
      if (
        error instanceof FirefliesDecodeError ||
        error instanceof GongDecodeError ||
        error instanceof FathomDecodeError ||
        error instanceof GranolaDecodeError
      )
        throw new TranscriptDecodeFailure();
      throw error;
    }
  },
});

type Failure = {
  readonly expectedCursor: string | null;
  readonly errorTag: TranscriptSyncErrorTag;
  readonly retryAfterMs: number | null;
};

export const runTranscriptSyncPage = async (input: {
  readonly cursor: string | null;
  readonly listPage: () => Promise<{
    readonly records: readonly unknown[];
    readonly nextCursor: string | null;
  }>;
  readonly normalize: (record: unknown) => Promise<CanonicalCallTranscript>;
  readonly ingest: (
    call: CanonicalCallTranscript,
  ) => Promise<"inserted" | "duplicate" | "tombstone">;
  readonly commit: (result: {
    readonly expectedCursor: string | null;
    readonly nextCursor: string | null;
    readonly discovered: number;
    readonly ingested: number;
    readonly duplicates: number;
  }) => Promise<unknown>;
  readonly fail: (failure: Failure) => Promise<unknown>;
}): Promise<
  | { readonly kind: "committed"; readonly nextCursor: string | null }
  | { readonly kind: "failed"; readonly errorTag: TranscriptSyncErrorTag }
> => {
  try {
    const page = await input.listPage();
    let ingested = 0;
    let duplicates = 0;
    for (const record of page.records) {
      const outcome = await input.ingest(await input.normalize(record));
      if (outcome === "duplicate") duplicates += 1;
      else ingested += 1;
    }
    await input.commit({
      expectedCursor: input.cursor,
      nextCursor: page.nextCursor,
      discovered: page.records.length,
      ingested,
      duplicates,
    });
    return { kind: "committed", nextCursor: page.nextCursor };
  } catch (error) {
    const failure: Failure =
      error instanceof TranscriptProviderRateLimited
        ? {
            expectedCursor: input.cursor,
            errorTag: "ProviderRateLimited",
            retryAfterMs: error.retryAfterMs,
          }
        : error instanceof TranscriptDecodeFailure
          ? {
              expectedCursor: input.cursor,
              errorTag: "PermanentDecodeFailure",
              retryAfterMs: null,
            }
          : {
              expectedCursor: input.cursor,
              errorTag: "ProviderUnavailable",
              retryAfterMs: 60_000,
            };
    await input.fail(failure);
    return { kind: "failed", errorTag: failure.errorTag };
  }
};
