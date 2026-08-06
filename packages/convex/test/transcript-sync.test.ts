import { Ref } from "@confect/core";
import {
  DatabaseSchema,
  RegisteredConvexFunction,
  RegisteredFunctions,
} from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  buildTranscriptConnectionHealth,
  claimTranscriptSyncState,
  commitTranscriptSyncState,
  failTranscriptSyncState,
  makeTranscriptSyncImpl,
  selectNextTranscriptSyncState,
  TranscriptSyncFenceError,
  type TranscriptSyncState,
} from "../confect/integrations/transcriptSync.impl";
import {
  createNangoTranscriptSyncProvider,
  runTranscriptSyncPage,
  TranscriptDecodeFailure,
  TranscriptProviderRateLimited,
} from "../confect/integrations/transcriptSync.node";
import transcriptSync, {
  claimTranscriptSyncPage,
  commitTranscriptSyncPage,
  failTranscriptSyncPage,
} from "../confect/integrations/transcriptSync.spec";
import connectorSyncStatesSource from "../confect/tables/connectorSyncStates";

const state = (
  overrides: Partial<TranscriptSyncState> = {},
): TranscriptSyncState => ({
  organizationKey: "agency_acme",
  connectionKey: "fireflies_agency_acme",
  connectionGeneration: 2,
  provider: "fireflies",
  status: "ready",
  cursor: "cursor-1",
  leaseId: null,
  leaseExpiresAt: null,
  nextAttemptAt: 1_000,
  lastSuccessAt: 900,
  callsDiscovered: 3,
  callsIngested: 3,
  duplicateCount: 0,
  failureCount: 0,
  lastErrorTag: null,
  backfillComplete: false,
  createdAt: 100,
  updatedAt: 900,
  ...overrides,
});

const canonicalCall = (id: string, deleted = false) => ({
  providerKey: "fireflies",
  connectionKey: "fireflies_agency_acme",
  externalCallId: id,
  externalRevisionId: `revision-${id}`,
  title: `Call ${id}`,
  startedAt: "2026-08-05T14:00:00.000Z",
  endedAt: "2026-08-05T14:01:00.000Z",
  durationMs: 60_000,
  organizer: null,
  participants: [],
  segments: deleted
    ? []
    : [
        {
          externalSegmentId: `${id}:0`,
          ordinal: 0,
          evidenceKind: "verbatim_transcript" as const,
          speakerExternalId: null,
          speakerLabel: "Unknown speaker",
          startMs: 0,
          endMs: 1_000,
          text: `Transcript ${id}`,
        },
      ],
  sourceUrl: `https://example.test/${id}`,
  recordingUrl: null,
  providerSummary: null,
  providerMetadataJson: "{}",
  deleted,
});

describe("transcript sync fencing", () => {
  it("claims, commits, and retains the cursor across failures", () => {
    const claimed = Effect.runSync(
      claimTranscriptSyncState({
        state: state(),
        connectionGeneration: 2,
        leaseId: "lease-1",
        now: 1_000,
      }),
    );
    expect(claimed).toMatchObject({
      status: "syncing",
      cursor: "cursor-1",
      leaseId: "lease-1",
    });

    const committed = Effect.runSync(
      commitTranscriptSyncState({
        state: claimed,
        connectionGeneration: 2,
        expectedCursor: "cursor-1",
        leaseId: "lease-1",
        nextCursor: "cursor-2",
        discovered: 2,
        ingested: 1,
        duplicates: 1,
        now: 1_100,
      }),
    );
    expect(committed).toMatchObject({
      status: "queued",
      cursor: "cursor-2",
      callsDiscovered: 5,
      callsIngested: 4,
      duplicateCount: 1,
      lastSuccessAt: 1_100,
    });

    const failed = Effect.runSync(
      failTranscriptSyncState({
        state: Effect.runSync(
          claimTranscriptSyncState({
            state: committed,
            connectionGeneration: 2,
            leaseId: "lease-2",
            now: 1_200,
          }),
        ),
        connectionGeneration: 2,
        expectedCursor: "cursor-2",
        leaseId: "lease-2",
        errorTag: "ProviderUnavailable",
        retryAfterMs: 30_000,
        now: 1_250,
      }),
    );
    expect(failed).toMatchObject({
      status: "retry_wait",
      cursor: "cursor-2",
      failureCount: 1,
      lastErrorTag: "ProviderUnavailable",
      nextAttemptAt: 31_250,
    });
    expect(JSON.stringify(failed)).not.toContain("raw provider payload");
  });

  it("rejects stale generations, leases, and cursors", () => {
    expect(
      Effect.runSync(
        Effect.flip(
          claimTranscriptSyncState({
            state: state(),
            connectionGeneration: 3,
            leaseId: "lease-1",
            now: 1_000,
          }),
        ),
      ),
    ).toBeInstanceOf(TranscriptSyncFenceError);
    expect(
      Effect.runSync(
        Effect.flip(
          claimTranscriptSyncState({
            state: state({
              status: "syncing",
              leaseId: "active-lease",
              leaseExpiresAt: 2_000,
            }),
            connectionGeneration: 2,
            leaseId: "new-lease",
            now: 1_000,
          }),
        ),
      ),
    ).toBeInstanceOf(TranscriptSyncFenceError);
    const claimed = Effect.runSync(
      claimTranscriptSyncState({
        state: state(),
        connectionGeneration: 2,
        leaseId: "lease-1",
        now: 1_000,
      }),
    );
    expect(
      Effect.runSync(
        Effect.flip(
          commitTranscriptSyncState({
            state: claimed,
            connectionGeneration: 2,
            expectedCursor: "wrong-cursor",
            leaseId: "wrong-lease",
            nextCursor: null,
            discovered: 0,
            ingested: 0,
            duplicates: 0,
            now: 1_100,
          }),
        ),
      ),
    ).toBeInstanceOf(TranscriptSyncFenceError);
  });

  it("selects due connections fairly by oldest attempt", () => {
    expect(
      selectNextTranscriptSyncState(
        [
          state({ connectionKey: "connection-newer", updatedAt: 800 }),
          state({ connectionKey: "connection-oldest", updatedAt: 500 }),
          state({
            connectionKey: "connection-not-due",
            updatedAt: 100,
            nextAttemptAt: 2_000,
          }),
        ],
        1_000,
      )?.connectionKey,
    ).toBe("connection-oldest");
  });
});

describe("transcript sync persistence", () => {
  const connectorSyncStates = connectorSyncStatesSource("connectorSyncStates");
  const transientDatabaseSchema = DatabaseSchema.make({
    ...databaseSchema.tables,
    connectorSyncStates,
  });
  const transientConvexSchema = defineSchema({
    ...Object.fromEntries(
      Object.entries(databaseSchema.tables).map(([name, table]) => [
        name,
        table.tableDefinition,
      ]),
    ),
    connectorSyncStates: connectorSyncStates.tableDefinition,
  });
  const impl = makeTranscriptSyncImpl();
  const registered = RegisteredFunctions.buildForGroup<typeof transcriptSync>(
    transientDatabaseSchema,
    impl,
    RegisteredConvexFunction.make,
  );
  const testLayer = TestConfect.layer(
    transientDatabaseSchema,
    transientConvexSchema,
    {
      ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
      "../convex/integrations/transcriptSync.ts": async () => registered,
    },
  );
  const refs = {
    claim: Ref.make("integrations/transcriptSync", claimTranscriptSyncPage),
    commit: Ref.make("integrations/transcriptSync", commitTranscriptSyncPage),
    fail: Ref.make("integrations/transcriptSync", failTranscriptSyncPage),
  };
  const seed = Effect.gen(function* () {
    yield* (yield* DatabaseWriter)
      .table("providerConnections")
      .insert({
        provider: "nango",
        providerConfigKey: "fireflies",
        organizationKey: "agency_acme",
        connectionKey: "fireflies_agency_acme",
        connectionGeneration: 0,
        status: "verifying",
        connectSessionId: "session-1",
        nangoConnectionId: "nango-connection-1",
        nangoEndUserId: "nango-user-1",
        nangoOrganizationId: "nango-org-1",
        correlationTag: "fireflies:session-1",
        attemptId: "attempt-1",
        attemptExpiresAt: 10_000,
        completedAt: 900,
        createdAt: 100,
        updatedAt: 900,
      })
      .pipe(Effect.orDie);
    return true;
  });

  it("activates, claims, and advances one fenced connection page", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seed, Schema.Boolean);
      const claimed = yield* confect.mutation(refs.claim, {
        connectionKey: "fireflies_agency_acme",
        expectedGeneration: 0,
        leaseId: "lease-1",
        now: 1_000,
      });
      const committed = yield* confect.mutation(refs.commit, {
        connectionKey: claimed.connectionKey,
        expectedGeneration: claimed.connectionGeneration,
        expectedCursor: claimed.cursor,
        leaseId: claimed.leaseId,
        nextCursor: "cursor-2",
        discovered: 2,
        ingested: 1,
        duplicates: 1,
        now: 1_100,
      });
      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const syncRows = yield* reader
            .table("connectorSyncStates")
            .index("by_connection", (q) =>
              q.eq("connectionKey", "fireflies_agency_acme"),
            )
            .collect()
            .pipe(Effect.orDie);
          const connection = yield* reader
            .table("providerConnections")
            .index("by_connection_key", (q) =>
              q.eq("connectionKey", "fireflies_agency_acme"),
            )
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          return { syncRows, connection };
        }),
        Schema.Any,
      );
      return { claimed, committed, rows };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer())),
    );
    expect(result.claimed).toMatchObject({
      connectionGeneration: 1,
      cursor: null,
      provider: "fireflies",
      leaseId: "lease-1",
    });
    expect(result.committed).toMatchObject({
      status: "queued",
      cursor: "cursor-2",
      callsDiscovered: 2,
      callsIngested: 1,
      duplicateCount: 1,
    });
    expect(result.rows.syncRows).toHaveLength(1);
    expect(result.rows.connection).toMatchObject({
      status: "active",
      connectionGeneration: 1,
    });
  });

  it("rejects an old generation after replacement", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seed, Schema.Boolean);
      const claimed = yield* confect.mutation(refs.claim, {
        connectionKey: "fireflies_agency_acme",
        expectedGeneration: 0,
        leaseId: "lease-1",
        now: 1_000,
      });
      return yield* Effect.either(
        confect.mutation(refs.fail, {
          connectionKey: claimed.connectionKey,
          expectedGeneration: 0,
          expectedCursor: claimed.cursor,
          leaseId: claimed.leaseId,
          errorTag: "ProviderUnavailable",
          retryAfterMs: 60_000,
          now: 1_100,
        }),
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer())),
    );
    expect(result).toMatchObject({ _tag: "Left" });
  });
});

describe("transcript connection health", () => {
  it("projects lifecycle, sync, and routing counts without provider payloads", () => {
    const health = buildTranscriptConnectionHealth({
      connections: [
        {
          providerConfigKey: "fireflies",
          organizationKey: "agency_acme",
          connectionKey: "fireflies_agency_acme",
          connectionGeneration: 1,
          status: "active",
        },
        {
          providerConfigKey: "gong-oauth",
          organizationKey: "agency_acme",
          connectionKey: "gong_agency_acme",
          connectionGeneration: 2,
          status: "reauthorizing",
        },
      ],
      syncStates: [
        state({
          connectionGeneration: 1,
          cursor: "cursor-2",
          backfillComplete: true,
        }),
      ],
      sourceUnits: [
        {
          connectionKey: "fireflies_agency_acme",
          unitKey: "unit-routed",
          lifecycle: { state: "active" },
        },
        {
          connectionKey: "fireflies_agency_acme",
          unitKey: "unit-awaiting",
          lifecycle: { state: "active" },
        },
      ],
      routes: [
        {
          unitKey: "unit-routed",
          outcome: "routed",
          status: "current",
        },
      ],
    });

    expect(health).toEqual([
      expect.objectContaining({
        provider: "fireflies",
        state: "ready",
        cursorPresent: true,
        callsDiscovered: 3,
        callsIngested: 3,
        callsRouted: 1,
        callsAwaitingRouting: 1,
        backfillComplete: true,
        lastErrorTag: null,
      }),
      expect.objectContaining({
        provider: "gong",
        state: "reauthorizing",
        callsRouted: 0,
        callsAwaitingRouting: 0,
      }),
    ]);
    expect(JSON.stringify(health)).not.toContain("nangoConnectionId");
  });
});

describe("transcript sync page execution", () => {
  it("commits only after duplicate, edit, and delete records are ingested", async () => {
    const events: string[] = [];
    const commit = vi.fn(async (result: unknown) => {
      events.push("commit");
      return result;
    });
    const fail = vi.fn();
    const records = [
      { id: "duplicate" },
      { id: "edited" },
      { id: "deleted", deleted: true },
    ];

    const result = await runTranscriptSyncPage({
      cursor: "cursor-1",
      listPage: async () => ({ records, nextCursor: "cursor-2" }),
      normalize: async (record) =>
        canonicalCall(
          (record as { id: string }).id,
          (record as { deleted?: boolean }).deleted,
        ),
      ingest: async (call) => {
        events.push(`ingest:${call.externalCallId}`);
        return call.externalCallId === "duplicate" ? "duplicate" : "inserted";
      },
      commit,
      fail,
    });

    expect(events).toEqual([
      "ingest:duplicate",
      "ingest:edited",
      "ingest:deleted",
      "commit",
    ]);
    expect(commit).toHaveBeenCalledWith({
      expectedCursor: "cursor-1",
      nextCursor: "cursor-2",
      discovered: 3,
      ingested: 2,
      duplicates: 1,
    });
    expect(fail).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "committed", nextCursor: "cursor-2" });
  });

  it("does not commit a cursor after partial ingestion failure", async () => {
    const commit = vi.fn();
    const fail = vi.fn(async (result: unknown) => result);
    const result = await runTranscriptSyncPage({
      cursor: "cursor-1",
      listPage: async () => ({
        records: [{ id: "first" }, { id: "second" }],
        nextCursor: "cursor-2",
      }),
      normalize: async (record) => canonicalCall((record as { id: string }).id),
      ingest: async (call) => {
        if (call.externalCallId === "second") throw new Error("storage failed");
        return "inserted" as const;
      },
      commit,
      fail,
    });

    expect(commit).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith({
      expectedCursor: "cursor-1",
      errorTag: "ProviderUnavailable",
      retryAfterMs: 60_000,
    });
    expect(result).toEqual({ kind: "failed", errorTag: "ProviderUnavailable" });
  });

  it("honors Retry-After and redacts permanent decode failures", async () => {
    const commit = vi.fn();
    const rateFail = vi.fn(async (result: unknown) => result);
    await runTranscriptSyncPage({
      cursor: null,
      listPage: async () => {
        throw new TranscriptProviderRateLimited(45_000);
      },
      normalize: async () => canonicalCall("unused"),
      ingest: async () => "inserted",
      commit,
      fail: rateFail,
    });
    expect(rateFail).toHaveBeenCalledWith({
      expectedCursor: null,
      errorTag: "ProviderRateLimited",
      retryAfterMs: 45_000,
    });

    const privateText = "PRIVATE_TRANSCRIPT_PAYLOAD";
    const decodeFail = vi.fn(async (result: unknown) => result);
    await runTranscriptSyncPage({
      cursor: null,
      listPage: async () => ({
        records: [{ text: privateText }],
        nextCursor: null,
      }),
      normalize: async () => {
        throw new TranscriptDecodeFailure();
      },
      ingest: async () => "inserted",
      commit,
      fail: decodeFail,
    });
    expect(decodeFail).toHaveBeenCalledWith({
      expectedCursor: null,
      errorTag: "PermanentDecodeFailure",
      retryAfterMs: null,
    });
    expect(JSON.stringify(decodeFail.mock.calls)).not.toContain(privateText);
  });
});

describe("Nango transcript provider", () => {
  it("loads and joins Fireflies transcript records", async () => {
    const listRecords = vi.fn(async () => ({
      records: [
        {
          id: "ff-call-1",
          title: "Redacted call",
          date: "2026-08-05T14:00:00.000Z",
          duration: 60,
          participants: [],
          transcript_url: "https://example.test/ff-call-1",
        },
      ],
      nextCursor: "next-fireflies",
    }));
    const proxy = vi.fn(async () => ({
      status: 200,
      data: {
        data: {
          transcript: {
            sentences: [
              {
                id: "sentence-1",
                transcript_id: "ff-call-1",
                index: 0,
                text: "Redacted sentence.",
                start_time: 1,
                end_time: 2,
              },
            ],
          },
        },
      },
    }));
    const provider = createNangoTranscriptSyncProvider(
      () => ({ listRecords, proxy }) as never,
    );
    const snapshot = {
      organizationKey: "agency_acme",
      connectionKey: "fireflies_agency_acme",
      connectionGeneration: 1,
      provider: "fireflies" as const,
      providerConfigKey: "fireflies",
      nangoConnectionId: "nango-1",
      cursor: null,
      leaseId: "lease-1",
    };

    const page = await provider.listPage(snapshot);
    const normalized = await provider.normalize(snapshot, page.records[0]);

    expect(listRecords).toHaveBeenCalledWith(
      expect.objectContaining({ model: "Transcript", limit: 100 }),
    );
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/graphql", method: "POST" }),
    );
    expect(page.nextCursor).toBe("next-fireflies");
    expect(normalized).toMatchObject({
      providerKey: "fireflies",
      externalCallId: "ff-call-1",
      segments: [expect.objectContaining({ text: "Redacted sentence." })],
    });
  });

  it("loads Gong call metadata and honors Retry-After", async () => {
    const transcript = {
      id: "gong-transcript-1",
      callId: "gong-call-1",
      transcript: [
        {
          speakerId: "speaker-1",
          sentences: [{ start: 0, end: 1_000, text: "Redacted sentence." }],
        },
      ],
    };
    const listRecords = vi.fn(async () => ({
      records: [transcript],
      nextCursor: null,
    }));
    const proxy = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          calls: [
            {
              id: "gong-call-1",
              title: "Redacted Gong call",
              started: "2026-08-05T14:00:00.000Z",
              duration: 60,
              parties: [],
              url: "https://example.test/gong-call-1",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        status: 429,
        headers: { "retry-after": "45" },
      });
    const provider = createNangoTranscriptSyncProvider(
      () => ({ listRecords, proxy }) as never,
    );
    const snapshot = {
      organizationKey: "agency_acme",
      connectionKey: "gong_agency_acme",
      connectionGeneration: 1,
      provider: "gong" as const,
      providerConfigKey: "gong-oauth",
      nangoConnectionId: "nango-2",
      cursor: null,
      leaseId: "lease-2",
    };

    await provider.listPage(snapshot);
    const normalized = await provider.normalize(snapshot, transcript);
    expect(listRecords).toHaveBeenCalledWith(
      expect.objectContaining({ model: "CallTranscript", limit: 100 }),
    );
    expect(normalized).toMatchObject({
      providerKey: "gong",
      externalCallId: "gong-call-1",
    });
    await expect(
      provider.normalize(snapshot, transcript),
    ).rejects.toMatchObject({
      _tag: "TranscriptProviderRateLimited",
      retryAfterMs: 45_000,
    });
  });

  it("pulls Fathom meetings and transcript detail through Nango proxy", async () => {
    const meeting = {
      recording_id: 123,
      title: "Redacted Fathom call",
      recording_start_time: "2026-08-05T14:00:00Z",
      recording_end_time: "2026-08-05T14:01:00Z",
      recorded_by: { name: "Host", email: "host@agency.test" },
      calendar_invitees: [],
      share_url: "https://example.test/fathom-123",
    };
    const proxy = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [meeting], next_cursor: "fathom-next" },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          transcript: [
            {
              speaker: { display_name: "Host" },
              text: "Redacted sentence.",
              timestamp: "00:00:01",
            },
          ],
        },
      });
    const provider = createNangoTranscriptSyncProvider(
      () => ({ proxy }) as never,
    );
    const snapshot = {
      organizationKey: "agency_acme",
      connectionKey: "fathom_agency_acme",
      connectionGeneration: 1,
      provider: "fathom" as const,
      providerConfigKey: "fathom-oauth",
      nangoConnectionId: "nango-3",
      cursor: null,
      leaseId: "lease-3",
    };

    const page = await provider.listPage(snapshot);
    const normalized = await provider.normalize(snapshot, page.records[0]);

    expect(proxy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        endpoint: "/external/v1/meetings?limit=100&include_summary=true",
        method: "GET",
      }),
    );
    expect(proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endpoint: "/external/v1/recordings/123/transcript",
        method: "GET",
      }),
    );
    expect(page.nextCursor).toBe("fathom-next");
    expect(normalized).toMatchObject({
      providerKey: "fathom",
      externalCallId: "123",
    });
  });

  it("pulls Granola note pages and transcript detail through Nango proxy", async () => {
    const summary = {
      id: "not_1d3tmYTlCICgjy",
      object: "note",
      title: "Redacted Granola call",
      owner: { name: "Host", email: "host@agency.test" },
      created_at: "2026-08-05T14:00:00Z",
      updated_at: "2026-08-05T14:01:00Z",
    };
    const proxy = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: { notes: [summary], hasMore: false, cursor: null },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          ...summary,
          web_url: "https://example.test/granola-note",
          calendar_event: null,
          attendees: [],
          summary_text: "Redacted provider note.",
          summary_markdown: null,
          transcript: null,
        },
      });
    const provider = createNangoTranscriptSyncProvider(
      () => ({ proxy }) as never,
    );
    const snapshot = {
      organizationKey: "agency_acme",
      connectionKey: "granola_agency_acme",
      connectionGeneration: 1,
      provider: "granola" as const,
      providerConfigKey: "granola",
      nangoConnectionId: "nango-4",
      cursor: null,
      leaseId: "lease-4",
    };

    const page = await provider.listPage(snapshot);
    const normalized = await provider.normalize(snapshot, page.records[0]);

    expect(proxy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        endpoint: "/v1/notes?page_size=30",
        method: "GET",
      }),
    );
    expect(proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endpoint: "/v1/notes/not_1d3tmYTlCICgjy?include=transcript",
        method: "GET",
      }),
    );
    expect(page.nextCursor).toBeNull();
    expect(normalized.segments).toEqual([
      expect.objectContaining({ evidenceKind: "provider_notes" }),
    ]);
  });
});
