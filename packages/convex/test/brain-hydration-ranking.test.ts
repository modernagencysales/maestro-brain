import { TestConfect } from "@confect/test";
import type { GenericId, Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import { Id } from "../confect/_generated/id";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseWriter } from "../confect/_generated/services";
import type { Role } from "../confect/access/roles";
import {
  buildRetrievalPassages,
  buildRetrievalTokenRows,
  retrievalEntryKey,
  retrievalEligibilityFenceKey,
  retrievalPublicationSetKey,
  retrievalPublicationSubjectKey,
  type RetrievalOrigin,
} from "../confect/brain/retrievalPublication";
import { publicationManifestHash } from "../confect/brain/publicationIntegrity";
import { retrievalTokenCatalogProjection } from "../confect/brain/retrievalTokenCatalog";
import { sha256Hex } from "../confect/shared/sha256";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;
const hydrationRankingBrainKey = "br_1123456789ABCDEFGHJKMNPQRS";

type SeededBrain = {
  readonly organizationId: GenericId<"organizations">;
  readonly workspaceId: GenericId<"workspaces">;
};

const SeededBrainSchema = Schema.Struct({
  organizationId: Id("organizations"),
  workspaceId: Id("workspaces"),
});

const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;

const seedBrain = (input: {
  readonly role: Role;
  readonly subject: string;
  readonly email: string;
  readonly brainKey: string;
}): Effect.Effect<SeededBrain, never, DatabaseWriter> =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const userId = yield* writer
      .table("users")
      .insert({
        subject: input.subject,
        email: input.email,
        displayName: input.subject,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: userId,
        name: input.brainKey,
        slug: input.brainKey.toLowerCase(),
        status: "active",
        workosOrganizationId: `org_${input.subject}`,
        agencyKey: `ag_${input.brainKey.slice(3)}`,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId,
        userId,
        role: input.role,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: userId,
        brainKey: input.brainKey,
        name: input.brainKey,
        slug: `${input.brainKey.toLowerCase()}-workspace`,
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId,
        userId,
        role: input.role,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return { organizationId, workspaceId };
  });

const seedHydrationRankingPublication = (
  seeded: SeededBrain,
  brainKey: string,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const organizationKey = `ag_${brainKey.slice(3)}`;
    const pageKey = "pag_hydration_ranking";
    const revisionKey = "rev_hydration_ranking";
    const corpusKey = "brain-pages";
    const title = "Hydration candidate ordering";
    const lifecycle = {
      state: "active" as const,
      generation: 1,
      updatedAt: now,
      purgeAfter: null,
    };
    const origin: RetrievalOrigin = {
      organizationKey,
      workspaceId: String(seeded.workspaceId),
      brainKey,
      corpusKey,
      originTable: "pageRevisions",
      kind: "page",
      origin: { kind: "page", pageKey, revisionKey },
      sourceKey: pageKey,
      sourceRevisionKey: revisionKey,
      title,
      sourceModifiedAt: now,
      observedAt: now,
      indexedAt: now,
      authority: "derived",
      authorityPolicyKey: "company-pages",
      policyGeneration: 1,
      lifecycleGeneration: 1,
      routeGeneration: 1,
    };
    const publicationSubjectKey = retrievalPublicationSubjectKey(origin);
    const publicationSetKey = retrievalPublicationSetKey(origin, 1);
    const paragraph = (index: number, highSalt: string) => {
      const rankingTerms = index === 40 ? 5 : 1;
      return [
        `Candidate ${String(index).padStart(2, "0")} salt ${index === 40 ? highSalt : "0000"}.`,
        ...Array.from({ length: rankingTerms }, () => "ranking"),
        "界".repeat(2_700),
      ].join(" ");
    };
    const markdownFor = (highSalt: string) =>
      Array.from({ length: 41 }, (_, index) => paragraph(index, highSalt)).join(
        "\n\n",
      );
    const basePassages = buildRetrievalPassages(
      markdownFor("0000"),
      revisionKey,
    );
    if (basePassages.length !== 41)
      return yield* Effect.dieMessage(
        `Expected 41 canonical passages, received ${basePassages.length}.`,
      );
    const lowEntryKeys = basePassages
      .slice(0, 40)
      .map((passage) => retrievalEntryKey(origin, passage));
    const greatestLowEntryKey = [...lowEntryKeys].sort().at(-1);
    const highTemplate = basePassages[40];
    if (greatestLowEntryKey === undefined || highTemplate === undefined)
      return yield* Effect.dieMessage("Missing hydration ranking passages.");
    let winningSalt: string | undefined;
    for (let salt = 0; salt <= 0xffff; salt += 1) {
      const candidateSalt = salt.toString(16).padStart(4, "0");
      const text = paragraph(40, candidateSalt);
      const contentHash = `sha256:${sha256Hex(JSON.stringify(text))}`;
      const passageKey = `rpass_${sha256Hex(
        JSON.stringify({
          originRevisionKey: revisionKey,
          ordinal: highTemplate.ordinal,
          headingPath: highTemplate.headingPath,
          startOffset: highTemplate.startOffset,
          endOffset: highTemplate.endOffset,
          contentHash,
        }),
      )}`;
      const candidateEntryKey = retrievalEntryKey(origin, {
        ...highTemplate,
        text,
        contentHash,
        passageKey,
      });
      if (candidateEntryKey > greatestLowEntryKey) {
        winningSalt = candidateSalt;
        break;
      }
    }
    if (winningSalt === undefined)
      return yield* Effect.dieMessage(
        "Unable to place the high-scoring passage after the first 40 postings.",
      );
    const markdown = markdownFor(winningSalt);
    const passages = buildRetrievalPassages(markdown, revisionKey);
    const entries = passages.map((passage) => ({
      schemaVersion: 1 as const,
      organizationKey,
      workspaceId: seeded.workspaceId,
      brainKey,
      publicationSubjectKey,
      entryKey: retrievalEntryKey(origin, passage),
      publicationSetKey,
      publicationGeneration: 1,
      kind: "page" as const,
      corpusKey,
      origin: { kind: "page" as const, pageKey, revisionKey },
      originTable: "pageRevisions",
      sourceKey: pageKey,
      sourceRevisionKey: revisionKey,
      passageKey: passage.passageKey,
      startOffset: passage.startOffset,
      endOffset: passage.endOffset,
      title,
      headingPath: passage.headingPath,
      text: passage.text,
      contentHash: passage.contentHash,
      sourceModifiedAt: now,
      observedAt: now,
      indexedAt: now,
      authority: "derived" as const,
      authorityPolicyKey: "company-pages",
      policyGeneration: 1,
      lifecycleGeneration: 1,
      routeGeneration: 1,
      state: "published" as const,
    }));
    const tokens = entries.flatMap((entry) =>
      buildRetrievalTokenRows({
        organizationKey,
        workspaceId: String(seeded.workspaceId),
        brainKey,
        entryKey: entry.entryKey,
        corpusKey,
        sourceModifiedAt: now,
        observedAt: now,
        title: entry.title,
        headingPath: entry.headingPath,
        text: entry.text,
        authority: entry.authority,
      }).map((token) => ({
        ...token,
        schemaVersion: 1 as const,
        workspaceId: seeded.workspaceId,
        publicationSetKey,
        publicationState: "current" as const,
      })),
    );
    const highEntry = entries[40];
    const rankingPostingOrder = tokens
      .filter(({ token }) => token === "ranking")
      .sort(
        (left, right) =>
          left.authorityRank - right.authorityRank ||
          left.entryKey.localeCompare(right.entryKey),
      )
      .map(({ entryKey }) => entryKey);
    if (
      entries.length !== 41 ||
      highEntry === undefined ||
      rankingPostingOrder.length !== 41 ||
      rankingPostingOrder[40] !== highEntry.entryKey
    )
      return yield* Effect.dieMessage(
        "The high-scoring entry is not beyond the first 40 posting rows.",
      );
    const lifecycleControllerKey = `page:${String(seeded.workspaceId)}:${pageKey}`;
    const lifecycleFenceKey = retrievalEligibilityFenceKey({
      organizationKey,
      kind: "lifecycle",
      controllerKey: lifecycleControllerKey,
    });
    yield* writer
      .table("brainPages")
      .insert({
        workspaceId: seeded.workspaceId,
        organizationId: seeded.organizationId,
        slug: "hydration-ranking",
        title,
        markdown,
        sourceKind: "markdown",
        updatedAt: now,
        pageKey,
        parentPageKey: null,
        siblingSlug: "hydration-ranking",
        sortKey: "0000000001",
        favorite: false,
        status: "active",
        currentRevisionKey: revisionKey,
        lifecycle,
        createdAt: now,
        schemaVersion: 1,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("pageRevisions")
      .insert({
        workspaceId: seeded.workspaceId,
        organizationId: seeded.organizationId,
        pageKey,
        revisionKey,
        priorRevisionKey: null,
        blockNoteJson: "",
        markdown,
        contentHash: `sha256:${sha256Hex(markdown)}`,
        causation: "import",
        actor: { kind: "migration", id: "hydration-ranking-test" },
        modelReceiptKey: null,
        effectKey: "hydration-ranking-test:1",
        state: "published",
        lifecycle,
        createdAt: now,
        schemaVersion: 1,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalEligibilityFences")
      .insert({
        schemaVersion: 1,
        organizationKey,
        fenceKey: lifecycleFenceKey,
        kind: "lifecycle",
        controllerKey: lifecycleControllerKey,
        eligibilityGeneration: 1,
        eligible: true,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalPublicationSubjects")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId: seeded.workspaceId,
        brainKey,
        corpusKey,
        publicationSubjectKey,
        originKind: "page",
        originTable: "pageRevisions",
        sourceKey: pageKey,
        currentPublicationSetKey: publicationSetKey,
        lastPublicationGeneration: 1,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("retrievalPublicationSets")
      .insert({
        schemaVersion: 1,
        organizationKey,
        workspaceId: seeded.workspaceId,
        brainKey,
        corpusKey,
        publicationSubjectKey,
        publicationSetKey,
        publicationGeneration: 1,
        originKind: "page",
        originTable: "pageRevisions",
        sourceKey: pageKey,
        sourceRevisionKey: revisionKey,
        routeGeneration: 1,
        lifecycleGeneration: 1,
        policyGeneration: 1,
        eligibilityFences: [
          {
            kind: "lifecycle",
            fenceKey: lifecycleFenceKey,
            eligibilityGeneration: 1,
          },
        ],
        expectedEntryCount: entries.length,
        expectedTokenCount: tokens.length,
        manifestHash: publicationManifestHash({
          entryKeys: entries.map(({ entryKey }) => entryKey),
          tokens,
        }),
        state: "current",
        createdAt: now,
        activatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const entry of entries)
      yield* writer.table("retrievalEntries").insert(entry).pipe(Effect.orDie);
    for (const token of tokens)
      yield* writer.table("retrievalTokens").insert(token).pipe(Effect.orDie);
    const tokensByTerm = new Map<string, typeof tokens>();
    for (const token of tokens)
      tokensByTerm.set(token.token, [
        ...(tokensByTerm.get(token.token) ?? []),
        token,
      ]);
    for (const [token, postings] of tokensByTerm)
      yield* writer
        .table("retrievalTokenCatalog")
        .insert({
          schemaVersion: 1,
          organizationKey,
          workspaceId: seeded.workspaceId,
          brainKey,
          tokenizerVersion: 1,
          token,
          ...retrievalTokenCatalogProjection(postings),
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    return {
      highEntryKey: highEntry.entryKey,
      highExcerpt: highEntry.text,
      rankingPostingOrder,
    };
  });

describe("Brain hydration ranking contract", () => {
  it("scores candidates beyond the first hydration page before production search returns the winner", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedBrain({
            role: "viewer",
            subject: "hydration-ranking-reader",
            email: "hydration-ranking-reader@example.com",
            brainKey: hydrationRankingBrainKey,
          }),
          SeededBrainSchema,
        );
        const fixture = yield* confect.run(
          seedHydrationRankingPublication(seeded, hydrationRankingBrainKey),
          resultSchema(),
        );
        const search = yield* confect.query(
          refs.internal.brain.readApi.validationSourcesSearch,
          {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: hydrationRankingBrainKey,
            query: "ranking",
          },
        );
        return { fixture, search };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(
      result.fixture.rankingPostingOrder.indexOf(result.fixture.highEntryKey),
    ).toBe(40);
    expect(result.search.results[0]).toMatchObject({
      entryKey: result.fixture.highEntryKey,
      sourceKey: "pag_hydration_ranking",
      sourceRevisionKey: "rev_hydration_ranking",
      kind: "page",
      authority: "derived",
      state: "resolved",
    });
    expect(result.fixture.highExcerpt.match(/\branking\b/g)).toHaveLength(5);
  }, 240_000);
});
