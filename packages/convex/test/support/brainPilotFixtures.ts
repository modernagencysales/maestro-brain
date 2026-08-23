import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { Id } from "../../confect/_generated/id";
import {
  DatabaseReader,
  DatabaseWriter,
} from "../../confect/_generated/services";
import type { Role } from "../../confect/access/roles";
import { buildRetrievalPassages } from "../../confect/brain/retrievalPublication";

export type SeededBrain = {
  readonly organizationId: GenericId<"organizations">;
  readonly workspaceId: GenericId<"workspaces">;
};

export const SeededBrainSchema = Schema.Struct({
  organizationId: Id("organizations"),
  workspaceId: Id("workspaces"),
});

type SeedBrainInput = {
  readonly role: Role;
  readonly subject: string;
  readonly email: string;
  readonly brainKey: string;
  readonly now?: number;
};

const seedUser = (input: SeedBrainInput, now: number) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    return yield* writer
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
  });

const seedOrganization = (
  input: SeedBrainInput,
  now: number,
  userId: GenericId<"users">,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const organization = {
      ownerUserId: userId,
      name: input.brainKey,
      slug: input.brainKey.toLowerCase(),
      status: "active" as const,
      workosOrganizationId: `org_${input.subject}`,
      agencyKey: `ag_${input.brainKey.slice(3)}`,
      createdAt: now,
      updatedAt: now,
    };
    return yield* writer
      .table("organizations")
      .insert(organization)
      .pipe(Effect.orDie);
  });

const seedOrganizationMember = (
  input: SeedBrainInput,
  now: number,
  organizationId: GenericId<"organizations">,
  userId: GenericId<"users">,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
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
  });

const seedWorkspace = (
  input: SeedBrainInput,
  now: number,
  organizationId: GenericId<"organizations">,
  userId: GenericId<"users">,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    return yield* writer
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
  });

const seedWorkspaceMember = (
  input: SeedBrainInput,
  now: number,
  workspaceId: GenericId<"workspaces">,
  userId: GenericId<"users">,
) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
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
  });

export const seedBrain = (
  input: SeedBrainInput,
): Effect.Effect<SeededBrain, never, DatabaseWriter> =>
  Effect.gen(function* () {
    const now = input.now ?? 1_782_924_800_000;
    const userId = yield* seedUser(input, now);
    const organizationId = yield* seedOrganization(input, now, userId);
    yield* seedOrganizationMember(input, now, organizationId, userId);
    const workspaceId = yield* seedWorkspace(
      input,
      now,
      organizationId,
      userId,
    );
    yield* seedWorkspaceMember(input, now, workspaceId, userId);
    return { organizationId, workspaceId };
  });

export const transcriptKeys = {
  unitKey: `sunit_${"a".repeat(64)}`,
  unitRevisionKey: `surev_${"b".repeat(64)}`,
  segmentKey: `seg_${"c".repeat(64)}`,
  connectionKey: "conn_fireflies_1",
} as const;

const transcriptConnection = (
  manual: boolean | undefined,
  organizationKey: string,
) => ({
  connectionKey: manual
    ? `manual_${organizationKey}`
    : transcriptKeys.connectionKey,
  connectionGeneration: manual ? 1 : 2,
  providerKey: manual ? "manual-transcript" : "fireflies",
});

export const seedTranscriptCitation = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly pageKey: string;
  readonly pageRevisionKey: string;
  readonly manual?: boolean;
  readonly brainKey?: string;
  readonly now?: number;
}): Effect.Effect<boolean, never, DatabaseReader | DatabaseWriter> =>
  Effect.gen(function* () {
    const now = input.now ?? 1_782_924_800_000;
    const brainKey = input.brainKey ?? "br_0123456789ABCDEFGHJKMNPQRS";
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const organizationKey = `ag_${brainKey.slice(3)}`;
    const { connectionKey, connectionGeneration, providerKey } =
      transcriptConnection(input.manual, organizationKey);
    const citation = yield* reader
      .table("citations")
      .index("by_workspace_page", (query) =>
        query
          .eq("workspaceId", String(input.workspaceId))
          .eq("pageKey", input.pageKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    if (citation === null) throw new Error("expected approved note citation");
    if (!input.manual)
      yield* writer
        .table("providerConnections")
        .insert({
          provider: "nango",
          providerConfigKey: "fireflies",
          organizationKey,
          connectionKey,
          connectionGeneration,
          status: "active",
          connectSessionId: "session_transcript_1",
          nangoConnectionId: "nango_transcript_1",
          nangoEndUserId: "end_user_transcript_1",
          nangoOrganizationId: "nango_org_transcript_1",
          correlationTag: "transcript:session_1",
          attemptId: "attempt_transcript_1",
          attemptExpiresAt: now + 10_000,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    yield* writer
      .table("sourceUnits")
      .insert({
        schemaVersion: 1,
        organizationKey,
        connectionKey,
        connectionGeneration,
        providerKey,
        externalCallId: "call_1",
        unitKey: transcriptKeys.unitKey,
        currentUnitRevisionKey: transcriptKeys.unitRevisionKey,
        lifecycle: {
          state: "active",
          generation: 1,
          updatedAt: now,
          purgeAfter: null,
        },
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("sourceUnitRevisions")
      .insert({
        schemaVersion: 1,
        organizationKey,
        unitKey: transcriptKeys.unitKey,
        unitRevisionKey: transcriptKeys.unitRevisionKey,
        externalRevisionId: "revision_1",
        title: "Acme weekly",
        startedAt: "2026-08-05T14:00:00.000Z",
        endedAt: "2026-08-05T14:30:00.000Z",
        durationMs: 1_800_000,
        organizer: null,
        participants: [],
        sourceUrl: "https://app.fireflies.ai/view/call_1",
        recordingUrl: null,
        providerSummary: null,
        providerMetadataJson: "{}",
        contentHash: `sha256:${"d".repeat(64)}`,
        tombstone: false,
        createdAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("sourceSegments")
      .insert({
        schemaVersion: 1,
        organizationKey,
        unitKey: transcriptKeys.unitKey,
        unitRevisionKey: transcriptKeys.unitRevisionKey,
        segmentKey: transcriptKeys.segmentKey,
        externalSegmentId: "call_1:0",
        ordinal: 0,
        evidenceKind: "verbatim_transcript",
        speakerExternalId: "speaker_1",
        speakerLabel: "Alex",
        startMs: 12_000,
        endMs: 15_400,
        text: "We will launch on Friday.",
        contentHash: `sha256:${"e".repeat(64)}`,
        createdAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("citations")
      .patch(citation._id, {
        sourceId: transcriptKeys.unitKey,
        sourceKind: "call_transcript",
        sourceTitle: "Acme weekly",
        quotedText: "We will launch on Friday.",
        startOffset: 0,
        endOffset: 25,
        pageKey: input.pageKey,
        revisionKey: input.pageRevisionKey,
        sourceUnitRevisionKey: transcriptKeys.unitRevisionKey,
        segmentKey: transcriptKeys.segmentKey,
        startMs: 12_000,
        endMs: 15_400,
      })
      .pipe(Effect.orDie);
    return true;
  });

export const insertCapacityEntry = (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly currentSetKey: string;
  readonly currentSubjectKey: string;
  readonly publicationSetKey: string;
  readonly entryKey: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly text: string;
  readonly now: number;
}): Effect.Effect<GenericId<"retrievalEntries">, never, DatabaseWriter> =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const passage = buildRetrievalPassages(
      input.text,
      input.sourceRevisionKey,
    )[0];
    if (passage === undefined)
      return yield* Effect.die("Expected a capacity-test passage.");
    const entryIdentity = capacityEntryIdentity(input);
    return yield* writer
      .table("retrievalEntries")
      .insert({
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        publicationSetKey: input.publicationSetKey,
        publicationGeneration: 1,
        entryKey: input.entryKey,
        ...entryIdentity,
        corpusKey: "capacity-test",
        sourceKey: input.sourceKey,
        sourceRevisionKey: input.sourceRevisionKey,
        passageKey: passage.passageKey,
        startOffset: passage.startOffset,
        endOffset: passage.endOffset,
        title: input.text,
        headingPath: null,
        text: passage.text,
        contentHash: passage.contentHash,
        observedAt: input.now,
        indexedAt: input.now,
        authority: "derived",
        authorityPolicyKey: "capacity-test",
        policyGeneration: 1,
        lifecycleGeneration: 1,
        routeGeneration: 1,
        state: "published",
      })
      .pipe(Effect.orDie);
  });

const capacityEntryIdentity = (input: {
  readonly publicationSetKey: string;
  readonly currentSetKey: string;
  readonly currentSubjectKey: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
}) => {
  const current = input.publicationSetKey === input.currentSetKey;
  return {
    ...(current ? { publicationSubjectKey: input.currentSubjectKey } : {}),
    kind: current ? ("page" as const) : ("projection" as const),
    origin: current
      ? {
          kind: "page" as const,
          pageKey: input.sourceKey,
          revisionKey: input.sourceRevisionKey,
        }
      : {
          kind: "projection" as const,
          projectionKey: input.sourceKey,
          revisionKey: input.sourceRevisionKey,
        },
    originTable: current
      ? ("pageRevisions" as const)
      : ("brainSources" as const),
  };
};
