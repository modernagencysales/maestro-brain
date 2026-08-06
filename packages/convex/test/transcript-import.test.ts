import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import { Id } from "../confect/_generated/id";
import refs from "../confect/_generated/refs";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { Forbidden, ValidationFailed } from "../confect/errors";
import { BrainNotFound } from "../confect/brain/pageTree";
import { testConfectLayer } from "./support/confect";

const now = 1_786_000_000_000;
const agencyKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const agencyBrainKey = "br_1123456789ABCDEFGHJKMNPQRS";
const clientBrainKey = "br_2123456789ABCDEFGHJKMNPQRS";
const foreignBrainKey = "br_3123456789ABCDEFGHJKMNPQRS";
const identity = {
  subject: "editor-subject",
  email: "editor@example.com",
} as const;
const input = {
  format: "vtt",
  content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nLaunch Friday.",
  title: "Customer call",
  occurredAt: "2026-08-05T14:00:00Z",
  participantEmails: ["buyer@client.test"],
} as const;

const Seed = Schema.Struct({
  agencyWorkspaceId: Id("workspaces"),
  agencyBrainKey: Schema.String,
  clientBrainKey: Schema.String,
  foreignBrainKey: Schema.String,
});

const seed = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const editorId = yield* writer
    .table("users")
    .insert({
      subject: identity.subject,
      email: identity.email,
      displayName: "Editor",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const viewerId = yield* writer
    .table("users")
    .insert({
      subject: "viewer-subject",
      email: "viewer@example.com",
      displayName: "Viewer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const outsiderId = yield* writer
    .table("users")
    .insert({
      subject: "outsider-subject",
      email: "outsider@example.com",
      displayName: "Outsider",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const limitedId = yield* writer
    .table("users")
    .insert({
      subject: "limited-subject",
      email: "limited@example.com",
      displayName: "Limited editor",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const organizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId: editorId,
      workosOrganizationId: "org_editor",
      agencyKey,
      slug: "agency-import",
      name: "Agency Import",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const agencyWorkspaceId = yield* writer
    .table("workspaces")
    .insert({
      organizationId,
      ownerUserId: editorId,
      brainKey: agencyBrainKey,
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
    .table("workspaceMembers")
    .insert({
      workspaceId: agencyWorkspaceId,
      userId: editorId,
      role: "editor",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId: agencyWorkspaceId,
      userId: limitedId,
      role: "editor",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("organizationMembers")
    .insert({
      organizationId,
      userId: editorId,
      role: "editor",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("organizationMembers")
    .insert({
      organizationId,
      userId: viewerId,
      role: "viewer",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId: agencyWorkspaceId,
      userId: viewerId,
      role: "viewer",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const clientWorkspaceId = yield* writer
    .table("workspaces")
    .insert({
      organizationId,
      ownerUserId: editorId,
      brainKey: clientBrainKey,
      slug: "client",
      name: "Client",
      kind: "client",
      status: "active",
      dataClassification: "confidential",
      createdAt: now,
      updatedAt: now,
      lifecycleGeneration: 1,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId: clientWorkspaceId,
      userId: editorId,
      role: "editor",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const foreignOrganizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId: outsiderId,
      workosOrganizationId: "org_outsider",
      agencyKey: "ag_4123456789ABCDEFGHJKMNPQRS",
      slug: "foreign",
      name: "Foreign",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaces")
    .insert({
      organizationId: foreignOrganizationId,
      ownerUserId: outsiderId,
      brainKey: foreignBrainKey,
      slug: "foreign-client",
      name: "Foreign Client",
      kind: "client",
      status: "active",
      dataClassification: "confidential",
      createdAt: now,
      updatedAt: now,
      lifecycleGeneration: 1,
    })
    .pipe(Effect.orDie);
  return {
    agencyWorkspaceId,
    agencyBrainKey,
    clientBrainKey,
    foreignBrainKey,
  };
});

const Counts = Schema.Struct({
  units: Schema.Number,
  revisions: Schema.Number,
  segments: Schema.Number,
  jobs: Schema.Number,
  routes: Schema.Number,
});
const counts = Effect.gen(function* () {
  const reader = yield* DatabaseReader;
  const [units, revisions, segments, jobs, routes] = yield* Effect.all([
    reader
      .table("sourceUnits")
      .index("by_unit_key", (q) => q.eq("organizationKey", agencyKey))
      .collect()
      .pipe(Effect.orDie),
    reader
      .table("sourceUnitRevisions")
      .index("by_unit_revision_key", (q) => q.eq("organizationKey", agencyKey))
      .collect()
      .pipe(Effect.orDie),
    reader
      .table("sourceSegments")
      .index("by_segment_key", (q) => q.eq("organizationKey", agencyKey))
      .collect()
      .pipe(Effect.orDie),
    reader
      .table("sourceProcessingJobs")
      .index("by_org_effect_key", (q) => q.eq("organizationKey", agencyKey))
      .collect()
      .pipe(Effect.orDie),
    reader
      .table("callRoutingProposals")
      .index("by_org_revision", (q) => q.eq("organizationKey", agencyKey))
      .collect()
      .pipe(Effect.orDie),
  ]);
  return {
    units: units.length,
    revisions: revisions.length,
    segments: segments.length,
    jobs: jobs.length,
    routes: routes.length,
  };
});

const run = <A, E>(
  program: Effect.Effect<A, E, TestConfect.TestConfect<typeof databaseSchema>>,
) => Effect.runPromise(program.pipe(Effect.provide(testConfectLayer())));

describe("transcript import persistence", () => {
  it("lets an editor persist and explicitly route an imported transcript", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seed, Seed);
      const result = yield* confect
        .withIdentity({ ...identity, workosOrganizationId: "org_editor" })
        .mutation(refs.public.capabilities.importTranscript.importTranscript, {
          brainKey: seeded.agencyBrainKey,
          ...input,
          targetBrainKey: seeded.clientBrainKey,
        });
      const persisted = yield* confect.run(counts, Counts);
      return { result, persisted };
    });

    await expect(run(program)).resolves.toMatchObject({
      result: {
        outcome: "inserted",
        segmentCount: 1,
        routeOutcome: "routed",
        brainKey: clientBrainKey,
      },
      persisted: { units: 1, revisions: 1, segments: 1, jobs: 1, routes: 1 },
    });
  });

  it.each([
    ["viewer-subject", "viewer@example.com"],
    ["outsider-subject", "outsider@example.com"],
  ])("rejects %s before persistence", async (subject, email) => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seed, Seed);
      return yield* confect
        .withIdentity({
          subject,
          email,
          workosOrganizationId:
            subject === "viewer-subject" ? "org_editor" : "org_outsider",
        })
        .mutation(refs.public.capabilities.importTranscript.importTranscript, {
          brainKey: seeded.agencyBrainKey,
          ...input,
        })
        .pipe(Effect.flip);
    });
    const error = await run(program);
    if (subject === "viewer-subject") expect(error).toBeInstanceOf(Forbidden);
    else expect(error).toHaveProperty("_tag");
  });

  it("rejects a foreign target Brain without persisting", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seed, Seed);
      const error = yield* confect
        .withIdentity({ ...identity, workosOrganizationId: "org_editor" })
        .mutation(refs.public.capabilities.importTranscript.importTranscript, {
          brainKey: seeded.agencyBrainKey,
          ...input,
          targetBrainKey: seeded.foreignBrainKey,
        })
        .pipe(Effect.flip);
      const persisted = yield* confect.run(counts, Counts);
      return { error, persisted };
    });
    const result = await run(program);
    expect(result.error).toBeInstanceOf(BrainNotFound);
    expect(result.persisted).toEqual({
      units: 0,
      revisions: 0,
      segments: 0,
      jobs: 0,
      routes: 0,
    });
  });

  it("requires editor access to an explicitly selected target Brain", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seed, Seed);
      const error = yield* confect
        .withIdentity({
          subject: "limited-subject",
          email: "limited@example.com",
          workosOrganizationId: "org_editor",
        })
        .mutation(refs.public.capabilities.importTranscript.importTranscript, {
          brainKey: seeded.agencyBrainKey,
          ...input,
          targetBrainKey: seeded.clientBrainKey,
        })
        .pipe(Effect.flip);
      const persisted = yield* confect.run(counts, Counts);
      return { error, persisted };
    });
    const result = await run(program);
    expect(result.error).toBeInstanceOf(BrainNotFound);
    expect(result.persisted).toEqual({
      units: 0,
      revisions: 0,
      segments: 0,
      jobs: 0,
      routes: 0,
    });
  });

  it("redacts parser failures as typed validation errors", async () => {
    const payloadMarker = "private transcript marker";
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seed, Seed);
      return yield* confect
        .withIdentity({ ...identity, workosOrganizationId: "org_editor" })
        .mutation(refs.public.capabilities.importTranscript.importTranscript, {
          brainKey: seeded.agencyBrainKey,
          ...input,
          format: "json",
          content: `{${payloadMarker}`,
        })
        .pipe(Effect.flip);
    });
    const error = await run(program);
    expect(error).toBeInstanceOf(ValidationFailed);
    expect(JSON.stringify(error)).not.toContain(payloadMarker);
  });
});
