import { TestConfect } from "@confect/test";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  MAX_SEARCH_EXAMINED_ENTRIES,
  MAX_SEARCH_POSTINGS_PER_PROVIDER_TOKEN,
  MAX_SEARCH_QUERY_TOKENS,
} from "../confect/brain/evidence.impl";
import {
  evidenceContentHash,
  evidencePassages,
} from "../confect/brain/evidenceProjection";
import { sha256Hex } from "../confect/shared/sha256";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

const evidence = (
  workspaceId: GenericId<"workspaces">,
  runKey: string,
  sourceKey: string,
  revisionKey: string,
  markdown: string,
) => ({
  workspaceId,
  provider: "slack" as const,
  scopeKey: "slack:apero-slack",
  runKey,
  sourceKey,
  revisionKey,
  title: `Slack evidence ${sourceKey}`,
  markdown,
  locator: `slack://apero/${sourceKey}`,
  sourceModifiedAt: now,
  observedAt: now,
});

const seedSlackConnection = (
  workspaceId: GenericId<"workspaces">,
  createdAt: number,
) =>
  Effect.gen(function* () {
    yield* (yield* DatabaseWriter)
      .table("providerConnections")
      .insert({
        workspaceId,
        provider: "slack",
        status: "active",
        generation: 1,
        connectionRef: "apero-slack",
        createdAt,
        updatedAt: createdAt,
      })
      .pipe(Effect.orDie);
  });

describe("Company Brain evidence publication", () => {
  it("keeps search posting reads bounded and indexes title terms once per entry", () => {
    expect(
      MAX_SEARCH_QUERY_TOKENS * MAX_SEARCH_POSTINGS_PER_PROVIDER_TOKEN * 6,
    ).toBeLessThanOrEqual(8_192);
    expect(MAX_SEARCH_EXAMINED_ENTRIES).toBeLessThanOrEqual(6);
    const projection = evidencePassages(
      "UniqueTitleToken",
      "body content ".repeat(180),
    );
    expect(projection.capacityExceeded).toBe(false);
    expect(projection.passages.length).toBeGreaterThan(1);
    expect(
      projection.passages
        .flatMap(({ tokens }) => tokens)
        .filter(({ token }) => token === "uniquetitletoken"),
    ).toHaveLength(1);
  });

  it("assembles Page, Slack, Drive, and CRM evidence through one cited Ask path", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* actor.mutation(refs.public.brain.pages.createMarkdown, {
        workspaceId: seeded.workspaceId,
        slug: "shared-plane-page",
        title: "Shared plane Page",
        markdown: "pagefact is maintained in a Brain Page.",
      });
      const providers = [
        ["slack", "slack", "slackfact"],
        ["google_drive", "google-drive", "drivefact"],
        ["hubspot", "hubspot", "crmfact"],
      ] as const;
      for (const [provider, connectionProvider, fact] of providers) {
        const scopeKey = `${provider}:shared-plane`;
        const runKey = `${provider}:shared-plane-run`;
        yield* confect.run(
          Effect.gen(function* () {
            yield* (yield* DatabaseWriter)
              .table("providerConnections")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: connectionProvider,
                status: "active",
                generation: 1,
                connectionRef: `${connectionProvider}-shared-plane`,
                evidenceScopeKey: scopeKey,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
        );
        yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
          workspaceId: seeded.workspaceId,
          provider,
          scopeKey,
          connectionGeneration: 1,
          runKey,
          startedAt: now,
        });
        yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
          workspaceId: seeded.workspaceId,
          provider,
          scopeKey,
          runKey,
          sourceKey: `${provider}:shared-plane-source`,
          revisionKey: "revision-1",
          title: `${provider} shared plane source`,
          markdown: `${fact} is current provider evidence.`,
          sourceModifiedAt: now,
          observedAt: now,
        });
        yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
          workspaceId: seeded.workspaceId,
          runKey,
          discoveredCount: 1,
          completedAt: now,
        });
      }
      yield* confect.mutation(refs.internal.ops.flags.upsertPolicyInternal, {
        workspaceId: seeded.workspaceId,
        key: "template.brain.contextV4",
        description: "Enable the shared provider-plane contract.",
        enabled: true,
        rolloutPercent: 100,
        audience: "workspace",
      });
      return yield* actor.query(
        refs.public.capabilities.askCompanyBrain.askCompanyBrain,
        {
          workspaceId: seeded.workspaceId,
          question: "pagefact slackfact drivefact crmfact",
          evidenceMode: "mixed",
          maxCitations: 10,
          asOf: now,
        },
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.status).toBe("answered");
    expect(result.contextPack.evidenceMode).toBe("mixed");
    expect(
      new Set(result.contextPack.citations.map(({ provider }) => provider)),
    ).toEqual(new Set(["brain_page", "slack", "google_drive", "hubspot"]));
  });

  it("examines a legacy entry once when invalid passage postings crowd valid evidence", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* actor.mutation(refs.public.brain.pages.createMarkdown, {
        workspaceId: seeded.workspaceId,
        slug: "valid-crowdtoken",
        title: "Valid crowded evidence",
        markdown: "The approved crowdtoken fact remains readable.",
      });
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const title = "Invalid legacy evidence";
          const markdown = "crowdtoken ".repeat(2_000);
          yield* writer
            .table("brainRetrievalEntries")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              entryKey: "invalid-legacy-crowd-entry",
              sourceKey: "invalid-legacy-crowd-source",
              revisionKey: "revision-1",
              title,
              markdown,
              contentHash: evidenceContentHash(title, markdown),
              projectionVersion: 2,
              sourceModifiedAt: now,
              observedAt: now,
              status: "current",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          for (let index = 0; index < 12; index += 1)
            yield* writer
              .table("brainRetrievalTokens")
              .insert({
                workspaceId: seeded.workspaceId,
                token: "crowdtoken",
                entryKey: "invalid-legacy-crowd-entry",
                passageKey: `legacy-passage-${index}`,
                passageStartOffset: index * 100,
                passageEndOffset: index * 100 + 640,
                sourceKey: "invalid-legacy-crowd-source",
                revisionKey: "revision-1",
                weight: 100,
                createdAt: now,
              })
              .pipe(Effect.orDie);
        }),
      );
      return yield* actor.query(refs.public.brain.evidence.search, {
        workspaceId: seeded.workspaceId,
        query: "crowdtoken",
        asOf: now,
        limit: 3,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toEqual([
      expect.objectContaining({
        provider: "brain_page",
        title: "Valid crowded evidence",
      }),
    ]);
  });

  it.each([
    ["slack", "slack"],
    ["google_drive", "google-drive"],
    ["hubspot", "hubspot"],
  ] as const)(
    "isolates overlapping %s source identities until scope activation",
    async (evidenceProvider, connectionProvider) => {
      const oldScope = `${evidenceProvider}:old-scope`;
      const sameScope = `${evidenceProvider}:same-revision-scope`;
      const changedScope = `${evidenceProvider}:changed-revision-scope`;
      const sourceKey = `${evidenceProvider}:shared-source`;
      const program = Effect.gen(function* () {
        const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
        const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
        const actor = confect.withIdentity({
          subject: "member-subject",
          email: "member@example.com",
        });
        yield* confect.run(
          Effect.gen(function* () {
            yield* (yield* DatabaseWriter)
              .table("providerConnections")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: connectionProvider,
                status: "active",
                generation: 1,
                connectionRef: `${connectionProvider}-connection`,
                evidenceScopeKey: oldScope,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
        );
        const publish = (
          scopeKey: string,
          runKey: string,
          revisionKey: string,
          markdown: string,
          observedAt: number,
        ) =>
          Effect.gen(function* () {
            yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
              workspaceId: seeded.workspaceId,
              provider: evidenceProvider,
              scopeKey,
              connectionGeneration: 1,
              runKey,
              startedAt: observedAt,
            });
            yield* confect.mutation(
              refs.internal.brain.evidence.publishRunItem,
              {
                workspaceId: seeded.workspaceId,
                provider: evidenceProvider,
                scopeKey,
                runKey,
                sourceKey,
                revisionKey,
                title: `${evidenceProvider} shared source`,
                markdown,
                sourceModifiedAt: observedAt,
                observedAt,
              },
            );
          });
        const setScopes = (
          evidenceScopeKey: string,
          pendingEvidenceScopeKey: string | undefined,
          updatedAt: number,
        ) =>
          confect.run(
            Effect.gen(function* () {
              const reader = yield* DatabaseReader;
              const writer = yield* DatabaseWriter;
              const connection = yield* reader
                .table("providerConnections")
                .index("by_workspace_and_provider", (q) =>
                  q
                    .eq("workspaceId", seeded.workspaceId)
                    .eq("provider", connectionProvider),
                )
                .first()
                .pipe(Effect.map(Option.getOrNull), Effect.orDie);
              if (connection === null)
                return yield* Effect.die("missing provider connection");
              yield* writer
                .table("providerConnections")
                .patch(connection._id, {
                  evidenceScopeKey,
                  pendingEvidenceScopeKey,
                  updatedAt,
                })
                .pipe(Effect.orDie);
            }),
          );

        yield* publish(
          oldScope,
          `${evidenceProvider}:old-run`,
          "revision-1",
          "Stable overlap corpus alpha.",
          now,
        );
        yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
          workspaceId: seeded.workspaceId,
          runKey: `${evidenceProvider}:old-run`,
          discoveredCount: 1,
          completedAt: now + 1,
        });
        const [oldEntry] = yield* actor.query(
          refs.public.brain.evidence.listCurrent,
          { workspaceId: seeded.workspaceId, provider: evidenceProvider },
        );

        yield* setScopes(oldScope, sameScope, now + 2);
        yield* publish(
          sameScope,
          `${evidenceProvider}:same-run`,
          "revision-1",
          "Stable overlap corpus alpha.",
          now + 2,
        );
        yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
          workspaceId: seeded.workspaceId,
          runKey: `${evidenceProvider}:same-run`,
          discoveredCount: 1,
          completedAt: now + 3,
        });
        const beforeSameActivation = yield* actor.query(
          refs.public.brain.evidence.listCurrent,
          { workspaceId: seeded.workspaceId, provider: evidenceProvider },
        );
        const pendingEntryKey = yield* confect.run(
          Effect.gen(function* () {
            const rows = yield* (yield* DatabaseReader)
              .table("brainRetrievalEntries")
              .index("by_workspace_provider_scope_status", (q) =>
                q
                  .eq("workspaceId", seeded.workspaceId)
                  .eq("provider", evidenceProvider)
                  .eq("scopeKey", sameScope)
                  .eq("status", "current"),
              )
              .take(2)
              .pipe(Effect.orDie);
            return rows[0]?.entryKey ?? "missing";
          }),
          Schema.String,
        );
        const pendingCurrent = yield* actor.query(
          refs.public.brain.evidence.currentGet,
          { workspaceId: seeded.workspaceId, entryKey: pendingEntryKey },
        );
        yield* setScopes(sameScope, undefined, now + 4);
        const afterSameActivation = yield* actor.query(
          refs.public.brain.evidence.listCurrent,
          { workspaceId: seeded.workspaceId, provider: evidenceProvider },
        );
        const reopenedSame = yield* actor.query(
          refs.public.brain.evidence.sourceGet,
          {
            workspaceId: seeded.workspaceId,
            sourceKey,
            revisionKey: "revision-1",
          },
        );

        yield* setScopes(sameScope, changedScope, now + 5);
        yield* publish(
          changedScope,
          `${evidenceProvider}:changed-failed-run`,
          "revision-2",
          "Changed overlap corpus beta.",
          now + 5,
        );
        yield* confect.mutation(refs.internal.brain.evidence.failRun, {
          workspaceId: seeded.workspaceId,
          runKey: `${evidenceProvider}:changed-failed-run`,
          failureCode: "provider_timeout",
          failedAt: now + 6,
        });
        yield* setScopes(sameScope, undefined, now + 6);
        const afterFailedChange = yield* actor.query(
          refs.public.brain.evidence.search,
          {
            workspaceId: seeded.workspaceId,
            query: "stable overlap alpha",
            asOf: now + 6,
          },
        );

        yield* setScopes(sameScope, changedScope, now + 7);
        yield* publish(
          changedScope,
          `${evidenceProvider}:changed-ready-run`,
          "revision-2",
          "Changed overlap corpus beta.",
          now + 7,
        );
        yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
          workspaceId: seeded.workspaceId,
          runKey: `${evidenceProvider}:changed-ready-run`,
          discoveredCount: 1,
          completedAt: now + 8,
        });
        yield* setScopes(changedScope, undefined, now + 9);
        const afterChangedActivation = yield* actor.query(
          refs.public.brain.evidence.search,
          {
            workspaceId: seeded.workspaceId,
            query: "changed overlap beta",
            asOf: now + 9,
          },
        );
        return {
          oldEntry,
          beforeSameActivation,
          pendingCurrent,
          afterSameActivation,
          reopenedSame,
          afterFailedChange,
          afterChangedActivation,
        };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testConfectLayer())),
      );
      expect(result.beforeSameActivation).toEqual([
        expect.objectContaining({ entryKey: result.oldEntry?.entryKey }),
      ]);
      expect(result.pendingCurrent).toBeNull();
      expect(result.afterSameActivation).toEqual([
        expect.objectContaining({ sourceKey }),
      ]);
      expect(result.afterSameActivation[0]?.entryKey).not.toBe(
        result.oldEntry?.entryKey,
      );
      expect(result.reopenedSame).toMatchObject({
        sourceKey,
        revisionKey: "revision-1",
        markdown: "Stable overlap corpus alpha.",
      });
      expect(result.afterFailedChange).toContainEqual(
        expect.objectContaining({ sourceKey, revisionKey: "revision-1" }),
      );
      expect(result.afterChangedActivation).toContainEqual(
        expect.objectContaining({ sourceKey, revisionKey: "revision-2" }),
      );
    },
    15_000,
  );

  it("keeps a 1,000-old plus 1,000-pending corpus within active read capacity", async () => {
    const oldScope = "slack:capacity-old";
    const pendingScope = "slack:capacity-pending";
    const oldMarkdown = "capacitycommon active corpus";
    const pendingMarkdown = "capacitycommon pending corpus";
    const title = "Capacity source";
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("providerConnections")
            .insert({
              workspaceId: seeded.workspaceId,
              provider: "slack",
              status: "active",
              generation: 1,
              connectionRef: "capacity-connection",
              evidenceScopeKey: oldScope,
              pendingEvidenceScopeKey: pendingScope,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          for (let index = 0; index < 1_000; index += 1) {
            const sourceKey = `capacity-${index}`;
            const oldEntryKey = `capacity-old-entry-${index}`;
            const pendingEntryKey = `capacity-pending-entry-${index}`;
            yield* writer
              .table("brainEvidenceSources")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey: oldScope,
                sourceKey,
                title,
                status: "active",
                generation: 1,
                currentRevisionKey: "revision-1",
                sourceModifiedAt: now + 2,
                observedAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainEvidenceSources")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey: pendingScope,
                sourceKey,
                title,
                status: "active",
                generation: 1,
                currentRevisionKey: "revision-1",
                sourceModifiedAt: now + 1,
                observedAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            const completed =
              index === 0
                ? {}
                : {
                    semanticPolicyVersion: "brain-extractor-v1",
                    semanticStatus: "completed" as const,
                  };
            yield* writer
              .table("brainRetrievalEntries")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey: oldScope,
                entryKey: oldEntryKey,
                sourceKey,
                revisionKey: "revision-1",
                title,
                markdown: oldMarkdown,
                contentHash: evidenceContentHash(title, oldMarkdown),
                projectionVersion: 2,
                sourceModifiedAt: now + 2,
                observedAt: now,
                status: "current",
                ...completed,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainRetrievalEntries")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey: pendingScope,
                entryKey: pendingEntryKey,
                sourceKey,
                revisionKey: "revision-1",
                title,
                markdown: pendingMarkdown,
                contentHash: evidenceContentHash(title, pendingMarkdown),
                projectionVersion: 2,
                sourceModifiedAt: now + 1,
                observedAt: now,
                status: "current",
                ...completed,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }
          for (let index = 0; index < 1_000; index += 1) {
            yield* writer
              .table("brainRetrievalTokens")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey: oldScope,
                token: "capacitycommon",
                entryKey: "capacity-old-entry-0",
                sourceKey: "capacity-0",
                revisionKey: "revision-1",
                weight: 1,
                createdAt: now + index,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("brainRetrievalTokens")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey: pendingScope,
                token: "capacitycommon",
                entryKey: "capacity-pending-entry-0",
                sourceKey: "capacity-0",
                revisionKey: "revision-1",
                weight: 1,
                createdAt: now + index,
              })
              .pipe(Effect.orDie);
          }
          for (const [scopeKey, markdown] of [
            [oldScope, oldMarkdown],
            [pendingScope, pendingMarkdown],
          ] as const)
            yield* writer
              .table("brainEvidenceRevisions")
              .insert({
                workspaceId: seeded.workspaceId,
                provider: "slack",
                scopeKey,
                sourceKey: "capacity-0",
                revisionKey: "revision-1",
                title,
                markdown,
                contentHash: evidenceContentHash(title, markdown),
                sourceModifiedAt: now,
                observedAt: now,
                tombstone: false,
                createdAt: now,
              })
              .pipe(Effect.orDie);
        }),
      );
      const search = yield* actor.query(refs.public.brain.evidence.search, {
        workspaceId: seeded.workspaceId,
        query: "capacitycommon",
        asOf: now,
      });
      const list = yield* actor.query(refs.public.brain.evidence.listCurrent, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        limit: 200,
      });
      const pendingCurrent = yield* actor.query(
        refs.public.brain.evidence.currentGet,
        {
          workspaceId: seeded.workspaceId,
          entryKey: "capacity-pending-entry-0",
        },
      );
      const queued = yield* actor.mutation(
        refs.public.capabilities.extractBrainKnowledgeCandidates
          .queueBrainKnowledgeExtraction,
        { workspaceId: seeded.workspaceId, limit: 1 },
      );
      const health = yield* actor.query(refs.public.brain.evidence.health, {
        workspaceId: seeded.workspaceId,
      });
      return { search, list, pendingCurrent, queued, health };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.search).toEqual([
      expect.objectContaining({
        sourceKey: "capacity-0",
        excerpt: expect.stringContaining("active corpus"),
      }),
    ]);
    expect(result.list).toHaveLength(200);
    expect(result.list).not.toContainEqual(
      expect.objectContaining({ entryKey: "capacity-pending-entry-0" }),
    );
    expect(result.pendingCurrent).toBeNull();
    expect(result.queued).toMatchObject({ scheduledCount: 1 });
    expect(result.health.providers).toContainEqual(
      expect.objectContaining({
        provider: "slack",
        activeSourceCount: 1_000,
        currentEntryCount: 1_000,
        capacityState: "within-bounds",
        coverageState: "current-index-covers-active-sources",
      }),
    );
  }, 60_000);

  it("reactivates one deterministic projection and repairs legacy same-revision keys", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const publish = (runKey: string, observedAt: number) =>
        Effect.gen(function* () {
          yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
            workspaceId: seeded.workspaceId,
            provider: "slack",
            scopeKey: "slack:apero-slack",
            runKey,
            startedAt: observedAt,
          });
          const projected = yield* confect.mutation(
            refs.internal.brain.evidence.publishRunItem,
            {
              ...evidence(
                seeded.workspaceId,
                runKey,
                "republished-source",
                "revision-1",
                "republished corpus exact revision",
              ),
              observedAt,
            },
          );
          yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
            workspaceId: seeded.workspaceId,
            runKey,
            discoveredCount: 1,
            completedAt: observedAt + 1,
          });
          return projected.entryKey;
        });

      const originalEntryKey = yield* publish("republish-original", now);
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "republish-withdrawal",
        startedAt: now + 2,
      });
      yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
        workspaceId: seeded.workspaceId,
        runKey: "republish-withdrawal",
        discoveredCount: 0,
        completedAt: now + 3,
      });
      const reactivatedEntryKey = yield* publish(
        "republish-reactivate",
        now + 4,
      );
      const reactivatedState = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const entries = yield* reader
            .table("brainRetrievalEntries")
            .index("by_workspace_and_entry_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("entryKey", reactivatedEntryKey),
            )
            .take(3)
            .pipe(Effect.orDie);
          return JSON.stringify(
            entries.map(({ entryKey, status, scopeKey, provider }) => ({
              entryKey,
              status,
              scopeKey,
              provider,
            })),
          );
        }),
        Schema.String,
      );

      yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const writer = yield* DatabaseWriter;
          const entry = yield* reader
            .table("brainRetrievalEntries")
            .index("by_workspace_and_entry_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("entryKey", reactivatedEntryKey),
            )
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          if (entry === null) return yield* Effect.die("missing projection");
          const tokens = yield* reader
            .table("brainRetrievalTokens")
            .index("by_workspace_and_entry_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("entryKey", reactivatedEntryKey),
            )
            .take(3_841)
            .pipe(Effect.orDie);
          yield* writer
            .table("brainRetrievalEntries")
            .patch(entry._id, {
              entryKey: "legacy-republished-entry",
              scopeKey: undefined,
              projectionVersion: 1,
            })
            .pipe(Effect.orDie);
          for (const token of tokens)
            yield* writer
              .table("brainRetrievalTokens")
              .patch(token._id, {
                entryKey: "legacy-republished-entry",
                provider: undefined,
                scopeKey: undefined,
              })
              .pipe(Effect.orDie);
        }),
      );
      const repairedEntryKey = yield* publish(
        "republish-repair-legacy",
        now + 6,
      );
      const current = yield* actor.query(
        refs.public.brain.evidence.currentGet,
        { workspaceId: seeded.workspaceId, entryKey: repairedEntryKey },
      );
      const search = yield* actor.query(refs.public.brain.evidence.search, {
        workspaceId: seeded.workspaceId,
        query: "republished corpus exact",
        asOf: now + 8,
      });
      const repairedState = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const entries = yield* reader
            .table("brainRetrievalEntries")
            .index("by_workspace_and_entry_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("entryKey", repairedEntryKey),
            )
            .take(3)
            .pipe(Effect.orDie);
          const tokens = yield* reader
            .table("brainRetrievalTokens")
            .index("by_workspace_and_entry_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("entryKey", repairedEntryKey),
            )
            .take(3_841)
            .pipe(Effect.orDie);
          return JSON.stringify({
            entries: entries.map(
              ({ entryKey, status, scopeKey, provider }) => ({
                entryKey,
                status,
                scopeKey,
                provider,
              }),
            ),
            tokens: tokens.map(({ entryKey, scopeKey, provider }) => ({
              entryKey,
              scopeKey,
              provider,
            })),
          });
        }),
        Schema.String,
      );
      return {
        originalEntryKey,
        reactivatedEntryKey,
        repairedEntryKey,
        reactivatedState,
        repairedState,
        current,
        search,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.reactivatedEntryKey).toBe(result.originalEntryKey);
    expect(JSON.parse(result.reactivatedState)).toEqual([
      {
        entryKey: result.originalEntryKey,
        status: "current",
        scopeKey: "slack:apero-slack",
        provider: "slack",
      },
    ]);
    expect(result.repairedEntryKey).toBe(result.originalEntryKey);
    expect(result.current).toMatchObject({
      sourceKey: "republished-source",
      revisionKey: "revision-1",
      markdown: "republished corpus exact revision",
    });
    expect(result.search).toContainEqual(
      expect.objectContaining({
        entryKey: result.originalEntryKey,
        sourceKey: "republished-source",
      }),
    );
    const repaired = JSON.parse(result.repairedState) as {
      entries: Array<Record<string, unknown>>;
      tokens: Array<Record<string, unknown>>;
    };
    expect(repaired.entries).toEqual([
      {
        entryKey: result.originalEntryKey,
        status: "current",
        scopeKey: "slack:apero-slack",
        provider: "slack",
      },
    ]);
    expect(repaired.tokens.length).toBeGreaterThan(0);
    expect(repaired.tokens).toEqual(
      repaired.tokens.map(() => ({
        entryKey: result.originalEntryKey,
        scopeKey: "slack:apero-slack",
        provider: "slack",
      })),
    );
  }, 15_000);

  it("ranks matching passages instead of combining distant whole-document terms", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-passages",
        startedAt: now,
      });
      yield* confect.mutation(
        refs.internal.brain.evidence.publishRunItem,
        evidence(
          seeded.workspaceId,
          "run-passages",
          "source-distant",
          "revision-1",
          `quasar ${"padding ".repeat(500)} nebula`,
        ),
      );
      yield* confect.mutation(
        refs.internal.brain.evidence.publishRunItem,
        evidence(
          seeded.workspaceId,
          "run-passages",
          "source-together",
          "revision-1",
          "The approved positioning pairs quasar nebula for the pilot.",
        ),
      );
      const results = yield* actor.query(refs.public.brain.evidence.search, {
        workspaceId: seeded.workspaceId,
        query: "quasar nebula",
        asOf: now,
        limit: 1,
      });
      return results;
    });

    const [result] = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toMatchObject({ sourceKey: "source-together" });
    expect(result?.excerpt).toContain("quasar nebula");
  });

  it("keeps immutable revisions and rejects changed content under one revision key", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-immutable",
        startedAt: now,
      });
      const first = yield* confect.mutation(
        refs.internal.brain.evidence.publishRunItem,
        evidence(
          seeded.workspaceId,
          "run-immutable",
          "message-1",
          "revision-1",
          "Original immutable content",
        ),
      );
      const duplicate = yield* confect.mutation(
        refs.internal.brain.evidence.publishRunItem,
        evidence(
          seeded.workspaceId,
          "run-immutable",
          "message-1",
          "revision-1",
          "Original immutable content",
        ),
      );
      const conflict = yield* confect
        .mutation(
          refs.internal.brain.evidence.publishRunItem,
          evidence(
            seeded.workspaceId,
            "run-immutable",
            "message-1",
            "revision-1",
            "Mutated content under the same revision",
          ),
        )
        .pipe(Effect.flip);
      return { first, duplicate, conflict };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.first.changed).toBe(true);
    expect(result.duplicate.changed).toBe(false);
    expect(result.conflict._tag).toBe("ValidationFailed");
  });

  it("rejects over-capacity evidence before changing source state", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-capacity",
        startedAt: now,
      });
      const failure = yield* confect
        .mutation(
          refs.internal.brain.evidence.publishRunItem,
          evidence(
            seeded.workspaceId,
            "run-capacity",
            "oversized-source",
            "revision-1",
            "evidence ".repeat(4_000),
          ),
        )
        .pipe(Effect.flip);
      const current = yield* actor.query(
        refs.public.brain.evidence.listCurrent,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          limit: 10,
        },
      );
      const reopening = yield* actor
        .query(refs.public.brain.evidence.sourceGet, {
          workspaceId: seeded.workspaceId,
          sourceKey: "oversized-source",
          revisionKey: "revision-1",
        })
        .pipe(Effect.flip);
      return { current, failure, reopening };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.failure._tag).toBe("ValidationFailed");
    expect(result.current).toEqual([]);
    expect(result.reopening._tag).toBe("NotFound");
  });

  it("keeps provider metadata immutable and reopenable with the revision", async () => {
    const providerMetadataJson = JSON.stringify({
      schemaVersion: 1,
      channelId: "C01",
      threadRootTimestamp: "178.1",
      messageRefs: [],
    });
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-metadata",
        startedAt: now,
      });
      const item = {
        ...evidence(
          seeded.workspaceId,
          "run-metadata",
          "thread-1",
          "revision-1",
          "Grounded thread content",
        ),
        providerMetadataJson,
        providerMetadataHash: sha256Hex(providerMetadataJson),
      };
      yield* confect.mutation(
        refs.internal.brain.evidence.publishRunItem,
        item,
      );
      const changedMetadataJson = JSON.stringify({
        ...JSON.parse(providerMetadataJson),
        channelId: "C02",
      });
      const conflict = yield* confect
        .mutation(refs.internal.brain.evidence.publishRunItem, {
          ...item,
          providerMetadataJson: changedMetadataJson,
          providerMetadataHash: sha256Hex(changedMetadataJson),
        })
        .pipe(Effect.flip);
      const reopened = yield* actor.query(
        refs.public.brain.evidence.sourceGet,
        {
          workspaceId: seeded.workspaceId,
          sourceKey: "thread-1",
          revisionKey: "revision-1",
        },
      );
      return { conflict, reopened };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.conflict._tag).toBe("ValidationFailed");
    expect(result.reopened).toMatchObject({
      providerMetadataJson,
      providerMetadataHash: sha256Hex(providerMetadataJson),
    });
  });

  it("reconciles only the completed provider scope", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      for (const [scopeKey, runKey, sourceKey] of [
        ["slack:connection-a", "run-a-1", "source-a"],
        ["slack:connection-b", "run-b-1", "source-b"],
      ] as const) {
        yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          scopeKey,
          runKey,
          startedAt: now,
        });
        yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
          ...evidence(
            seeded.workspaceId,
            runKey,
            sourceKey,
            "revision-1",
            `Evidence for ${sourceKey}`,
          ),
          scopeKey,
        });
        yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
          workspaceId: seeded.workspaceId,
          runKey,
          discoveredCount: 1,
          completedAt: now + 1,
        });
      }
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:connection-a",
        runKey: "run-a-2",
        startedAt: now + 2,
      });
      const completion = yield* confect.mutation(
        refs.internal.brain.evidence.completeRun,
        {
          workspaceId: seeded.workspaceId,
          runKey: "run-a-2",
          discoveredCount: 0,
          completedAt: now + 3,
        },
      );
      const health = yield* actor.query(refs.public.brain.evidence.health, {
        workspaceId: seeded.workspaceId,
      });
      const browsable = yield* actor.query(
        refs.public.brain.evidence.listCurrent,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          limit: 10,
        },
      );
      return { completion, health, browsable };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.completion.retiredCount).toBe(1);
    expect(result.health.providers).toContainEqual(
      expect.objectContaining({
        provider: "slack",
        activeSourceCount: 0,
        removedSourceCount: 0,
      }),
    );
    expect(result.browsable).toEqual([]);
  });

  it("reconciles removals only after a successful full traversal and reopens exact revisions", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });

      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-complete-1",
        startedAt: now,
      });
      for (const [sourceKey, markdown] of [
        ["message-a", "Apero pricing evidence alpha"],
        ["message-b", "Apero pricing evidence beta"],
      ] as const)
        yield* confect.mutation(
          refs.internal.brain.evidence.publishRunItem,
          evidence(
            seeded.workspaceId,
            "run-complete-1",
            sourceKey,
            "revision-1",
            markdown,
          ),
        );
      yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
        workspaceId: seeded.workspaceId,
        runKey: "run-complete-1",
        discoveredCount: 2,
        completedAt: now + 1,
      });

      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-failed",
        startedAt: now + 2,
      });
      yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
        ...evidence(
          seeded.workspaceId,
          "run-failed",
          "message-a",
          "revision-2",
          "Apero pricing evidence alpha updated",
        ),
        observedAt: now + 2,
      });
      yield* confect.mutation(refs.internal.brain.evidence.failRun, {
        workspaceId: seeded.workspaceId,
        runKey: "run-failed",
        failureCode: "provider_timeout",
        failedAt: now + 3,
      });
      const afterFailure = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "beta",
          asOf: now + 3,
          limit: 10,
        },
      );

      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:apero-slack",
        runKey: "run-complete-2",
        startedAt: now + 4,
      });
      yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
        ...evidence(
          seeded.workspaceId,
          "run-complete-2",
          "message-a",
          "revision-2",
          "Apero pricing evidence alpha updated",
        ),
        observedAt: now + 4,
      });
      const completion = yield* confect.mutation(
        refs.internal.brain.evidence.completeRun,
        {
          workspaceId: seeded.workspaceId,
          runKey: "run-complete-2",
          discoveredCount: 1,
          completedAt: now + 5,
        },
      );
      const afterSuccess = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "beta",
          asOf: now + 5,
          limit: 10,
        },
      );
      const reopened = yield* actor.query(
        refs.public.brain.evidence.sourceGet,
        {
          workspaceId: seeded.workspaceId,
          sourceKey: "message-b",
          revisionKey: "revision-1",
        },
      );
      const health = yield* actor.query(refs.public.brain.evidence.health, {
        workspaceId: seeded.workspaceId,
      });
      const browsable = yield* actor.query(
        refs.public.brain.evidence.listCurrent,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          limit: 10,
        },
      );
      const current = yield* actor.query(
        refs.public.brain.evidence.currentGet,
        {
          workspaceId: seeded.workspaceId,
          entryKey: browsable[0]?.entryKey ?? "missing",
        },
      );
      yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const writer = yield* DatabaseWriter;
          const connection = yield* reader
            .table("providerConnections")
            .index("by_workspace_and_provider", (q) =>
              q.eq("workspaceId", seeded.workspaceId).eq("provider", "slack"),
            )
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          if (connection !== null)
            yield* writer
              .table("providerConnections")
              .patch(connection._id, {
                status: "revoked",
                updatedAt: now + 6,
              })
              .pipe(Effect.orDie);
        }),
      );
      const afterRevoke = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "alpha",
          asOf: now + 6,
          limit: 10,
        },
      );
      const browsableAfterRevoke = yield* actor.query(
        refs.public.brain.evidence.listCurrent,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          limit: 10,
        },
      );
      const currentAfterRevoke = yield* actor.query(
        refs.public.brain.evidence.currentGet,
        {
          workspaceId: seeded.workspaceId,
          entryKey: browsable[0]?.entryKey ?? "missing",
        },
      );
      return {
        afterFailure,
        completion,
        afterSuccess,
        reopened,
        health,
        browsable,
        current,
        afterRevoke,
        browsableAfterRevoke,
        currentAfterRevoke,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.afterFailure).toEqual([
      expect.objectContaining({ sourceKey: "message-b" }),
    ]);
    expect(result.completion.retiredCount).toBe(1);
    expect(result.afterSuccess).toEqual([]);
    expect(result.reopened).toMatchObject({
      sourceKey: "message-b",
      revisionKey: "revision-1",
      markdown: "Apero pricing evidence beta",
      tombstone: false,
    });
    expect(result.afterRevoke).toEqual([]);
    expect(result.browsableAfterRevoke).toEqual([]);
    expect(result.currentAfterRevoke).toBeNull();
    expect(result.health.countLimit).toBe(1_000);
    expect(result.health.providers).toContainEqual(
      expect.objectContaining({
        provider: "slack",
        activeSourceCount: 1,
        removedSourceCount: 1,
        currentEntryCount: 1,
        capacityState: "within-bounds",
        coverageState: "current-index-covers-active-sources",
        latestSourceModifiedAt: now,
        latestObservedAt: now + 5,
        latestIndexedAt: expect.any(Number),
        lastSuccessfulReconciliationAt: now + 5,
        freshnessState: "unknown-no-policy",
        lastConnectorRun: expect.objectContaining({
          runKey: "run-complete-2",
          status: "complete",
          completedAt: now + 5,
        }),
      }),
    );
    expect(result.browsable).toEqual([
      expect.objectContaining({
        provider: "slack",
        sourceKey: "message-a",
        excerpt: "Apero pricing evidence alpha updated",
      }),
    ]);
    expect(result.current).toMatchObject({
      provider: "slack",
      sourceKey: "message-a",
      markdown: "Apero pricing evidence alpha updated",
    });
  });

  it("activates a generation-fenced replacement before cleaning 101 withdrawn sources", async () => {
    const oldScope = "slack:apero-slack";
    const newScope = "slack:apero-slack:channel:C2:lookback:30";
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(seedSlackConnection(seeded.workspaceId, now));
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: oldScope,
        runKey: "run-old-scope-101",
        startedAt: now,
      });
      for (let index = 0; index < 101; index += 1)
        yield* confect.mutation(
          refs.internal.brain.evidence.publishRunItem,
          evidence(
            seeded.workspaceId,
            "run-old-scope-101",
            `old-${index}`,
            "revision-1",
            `withdrawn-${index}`,
          ),
        );
      yield* confect.mutation(refs.internal.brain.evidence.completeRun, {
        workspaceId: seeded.workspaceId,
        runKey: "run-old-scope-101",
        discoveredCount: 101,
        completedAt: now + 1,
      });
      yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: 1,
          syncAttemptKey: "slack-new-scope-attempt",
          status: "syncing",
          channelIds: ["C2"],
          lookbackDays: 30,
        },
      );
      yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: 1,
          syncAttemptKey: "slack-new-scope-attempt",
          status: "syncing",
          evidenceScopeKey: newScope,
        },
      );
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: newScope,
        connectionGeneration: 1,
        runKey: "run-new-scope",
        startedAt: now + 2,
      });
      yield* confect.mutation(refs.internal.brain.evidence.publishRunItem, {
        ...evidence(
          seeded.workspaceId,
          "run-new-scope",
          "new-source",
          "revision-1",
          "replacement-corpus",
        ),
        scopeKey: newScope,
      });
      const completion = yield* confect.mutation(
        refs.internal.brain.evidence.completeRun,
        {
          workspaceId: seeded.workspaceId,
          runKey: "run-new-scope",
          discoveredCount: 1,
          completedAt: now + 3,
        },
      );
      const hiddenBeforeActivation = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "replacement-corpus",
          asOf: now + 4,
        },
      );
      const oldBeforeActivation = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "withdrawn-100",
          asOf: now + 4,
        },
      );
      const browsableBeforeActivation = yield* actor.query(
        refs.public.brain.evidence.listCurrent,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          limit: 200,
        },
      );
      yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: 1,
          syncAttemptKey: "slack-new-scope-attempt",
          status: "ready",
          evidenceScopeKey: newScope,
        },
      );
      const replacement = yield* actor.query(
        refs.public.brain.evidence.search,
        {
          workspaceId: seeded.workspaceId,
          query: "replacement-corpus",
          asOf: now + 4,
        },
      );
      const withdrawn = yield* actor.query(refs.public.brain.evidence.search, {
        workspaceId: seeded.workspaceId,
        query: "withdrawn-100",
        asOf: now + 4,
      });
      const browsableAfterActivation = yield* actor.query(
        refs.public.brain.evidence.listCurrent,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          limit: 200,
        },
      );
      const first = yield* confect.mutation(
        refs.internal.brain.evidence.retireInactiveProviderScopes,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          activeScopeKey: newScope,
          connectionGeneration: 1,
          observedAt: now + 5,
        },
      );
      const second = yield* confect.mutation(
        refs.internal.brain.evidence.retireInactiveProviderScopes,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          activeScopeKey: newScope,
          connectionGeneration: 1,
          observedAt: now + 5,
        },
      );
      const third = yield* confect.mutation(
        refs.internal.brain.evidence.retireInactiveProviderScopes,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          activeScopeKey: newScope,
          connectionGeneration: 1,
          observedAt: now + 5,
        },
      );
      return {
        completion,
        first,
        second,
        third,
        hiddenBeforeActivation,
        oldBeforeActivation,
        browsableBeforeActivation,
        browsableAfterActivation,
        replacement,
        withdrawn,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.completion).toMatchObject({
      complete: true,
      retiredCount: 0,
    });
    expect(result.hiddenBeforeActivation).toEqual([]);
    expect(result.oldBeforeActivation).toContainEqual(
      expect.objectContaining({ sourceKey: "old-100" }),
    );
    expect(result.browsableBeforeActivation).toHaveLength(101);
    expect(result.browsableBeforeActivation).not.toContainEqual(
      expect.objectContaining({ sourceKey: "new-source" }),
    );
    expect(result.browsableAfterActivation).toEqual([
      expect.objectContaining({ sourceKey: "new-source" }),
    ]);
    expect(result.replacement).toEqual([
      expect.objectContaining({ sourceKey: "new-source" }),
    ]);
    expect(result.withdrawn).toEqual([]);
    expect(result.first).toEqual({ complete: false, retiredCount: 50 });
    expect(result.second).toEqual({ complete: false, retiredCount: 50 });
    expect(result.third).toEqual({ complete: true, retiredCount: 1 });
  }, 30_000);
});
