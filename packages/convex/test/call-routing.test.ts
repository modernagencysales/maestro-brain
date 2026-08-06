import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import { Id } from "../confect/_generated/id";
import refs from "../confect/_generated/refs";
import { DatabaseWriter } from "../confect/_generated/services";
import { buildCallSourceUnitRows } from "../confect/sources/sourceUnit";
import { testConfectLayer } from "./support/confect";

const now = 1_000;
const organizationKey = "agency_acme";
const caller = {
  kind: "system",
  name: "source-router",
  surface: "internal",
} as const;
const call = {
  providerKey: "fireflies",
  connectionKey: "conn_fireflies_1",
  externalCallId: "call_1",
  externalRevisionId: "revision_1",
  title: "Acme weekly",
  startedAt: "2026-08-05T14:00:00.000Z",
  endedAt: "2026-08-05T14:30:00.000Z",
  durationMs: 1_800_000,
  organizer: null,
  participants: [
    {
      externalParticipantId: "buyer_1",
      displayName: "Buyer",
      email: "buyer@acme.com",
      domain: "acme.com",
    },
  ],
  segments: [
    {
      externalSegmentId: "call_1:0",
      ordinal: 0,
      evidenceKind: "verbatim_transcript",
      speakerExternalId: "buyer_1",
      speakerLabel: "Buyer",
      startMs: 0,
      endMs: 2_000,
      text: "Acme will launch on Friday.",
    },
  ],
  sourceUrl: "https://app.fireflies.ai/view/call_1",
  recordingUrl: null,
  providerSummary: null,
  providerMetadataJson: "{}",
  deleted: false,
} as const;
const rows = buildCallSourceUnitRows(call, {
  organizationKey,
  connectionGeneration: 1,
  receivedAt: now,
});

const seed = (withMapping = true) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: "user_owner",
        agencyKey: organizationKey,
        slug: "agency-acme",
        name: "Agency Acme",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const agencyWorkspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: "user_owner",
        slug: "agency",
        name: "Agency",
        kind: "agency",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
        lifecycleGeneration: 1,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: "user_owner",
        brainKey: "br_acme",
        slug: "acme",
        name: "Acme",
        kind: "client",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
        lifecycleGeneration: 1,
      })
      .pipe(Effect.orDie);
    yield* writer.table("sourceUnits").insert(rows.unit).pipe(Effect.orDie);
    yield* writer
      .table("sourceUnitRevisions")
      .insert(rows.revision)
      .pipe(Effect.orDie);
    for (const segment of rows.segments)
      yield* writer.table("sourceSegments").insert(segment).pipe(Effect.orDie);
    if (withMapping)
      yield* writer
        .table("callRouteMappings")
        .insert({
          schemaVersion: 1,
          organizationKey,
          mappingKey: "route_map_acme_domain",
          kind: "domain",
          value: "acme.com",
          brainKey: "br_acme",
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    return agencyWorkspaceId;
  });

describe("call routing persistence", () => {
  it("routes the current call revision only to an authorized exact match", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seed(), Schema.String);
      const first = yield* confect.mutation(
        refs.internal.capabilities.routeCallToBrain.routeCallToBrain,
        {
          organizationKey,
          unitRevisionKey: rows.revision.unitRevisionKey,
          agencyDomains: ["maestrogtm.com"],
          caller,
          routedAt: now + 1,
        },
      );
      const duplicate = yield* confect.mutation(
        refs.internal.capabilities.routeCallToBrain.routeCallToBrain,
        {
          organizationKey,
          unitRevisionKey: rows.revision.unitRevisionKey,
          agencyDomains: ["maestrogtm.com"],
          caller,
          routedAt: now + 2,
        },
      );
      return { first, duplicate };
    });

    await expect(
      Effect.runPromise(program.pipe(Effect.provide(testConfectLayer()))),
    ).resolves.toMatchObject({
      first: {
        outcome: "routed",
        brainKey: "br_acme",
        reason: "participant_domain",
        routeGeneration: 1,
      },
      duplicate: {
        outcome: "routed",
        brainKey: "br_acme",
        reason: "participant_domain",
        routeGeneration: 1,
      },
    });
  });

  it("gathers exact call evidence and an organization-closed candidate list", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const workspaceId = yield* confect.run(seed(false), Id("workspaces"));
      const route = yield* confect.mutation(
        refs.internal.capabilities.routeCallToBrain.routeCallToBrain,
        {
          organizationKey,
          unitRevisionKey: rows.revision.unitRevisionKey,
          agencyDomains: ["maestrogtm.com"],
          caller,
          routedAt: now + 1,
        },
      );
      const gathered = yield* confect.query(
        refs.internal.workflowContracts.sourceClassification.gather,
        {
          workspaceId,
          sourceUnitRevisionKey: rows.revision.unitRevisionKey,
          caller,
        },
      );
      const output = yield* confect.mutation(
        refs.internal.capabilities.classifySourceUnit.classifySourceUnit,
        { request: gathered, caller },
      );
      const committed = yield* confect.mutation(
        refs.internal.capabilities.classifySourceUnit.commitSourceRoute,
        {
          workspaceId,
          idempotencyKey: "review_call_1",
          request: gathered,
          output,
          review: {
            action: "accept",
            reviewerPrincipalKey: "user_admin",
            reviewerAuthority: {
              workspaceId,
              organizationId: gathered.organizationId,
              role: "admin",
            },
          },
          currentAuthority: gathered.authority,
          caller,
        },
      );
      const accepted = yield* confect.mutation(
        refs.internal.capabilities.routeCallToBrain.routeCallToBrain,
        {
          organizationKey,
          unitRevisionKey: rows.revision.unitRevisionKey,
          agencyDomains: ["maestrogtm.com"],
          caller,
          routedAt: now + 2,
        },
      );
      return { route, gathered, output, committed, accepted };
    });

    await expect(
      Effect.runPromise(program.pipe(Effect.provide(testConfectLayer()))),
    ).resolves.toMatchObject({
      route: {
        outcome: "no_match",
        brainKey: null,
        candidateBrainKeys: ["br_acme"],
      },
      gathered: {
        sourceUnitRevisionKey: rows.revision.unitRevisionKey,
        sourceUnitHash: rows.revision.contentHash,
        messages: [
          {
            sourceRevisionKey: rows.segments[0]?.segmentKey,
            canonicalText: "Acme will launch on Friday.",
          },
        ],
        allowedTargets: [{ brainKey: "br_acme", displayName: "Acme" }],
      },
      output: { contentScope: "single_target", targetBrainKey: "br_acme" },
      committed: { stage: "routed", targetBrainKey: "br_acme" },
      accepted: {
        outcome: "routed",
        brainKey: "br_acme",
        reason: "review_accept",
      },
    });
  });
});
