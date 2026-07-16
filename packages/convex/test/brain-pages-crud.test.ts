import { TestConfect } from "@confect/test";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { Role } from "../confect/access/roles";
import refs from "../confect/_generated/refs";
import {
  manifest,
  RecordSnapshotArgs,
  schemaRegistry,
} from "../confect/brain/pages.spec";
import databaseSchema from "../confect/_generated/schema";
import { Id } from "../confect/_generated/id";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { Forbidden, Unauthorized, ValidationFailed } from "../confect/errors";
import {
  BrainNotFound,
  LifecycleRevoked,
  PageNotFound,
  PageTreeConflict,
  StaleRevision,
} from "../confect/brain/pageTree";
import { PageRevisionRow } from "../confect/brain/pageSchemas";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;
const editorBrainKey = "br_0123456789ABCDEFGHJKMNPQRS";
const viewerBrainKey = "br_1123456789ABCDEFGHJKMNPQRS";
const archivedBrainKey = "br_2123456789ABCDEFGHJKMNPQRS";
const matrixBrainKey = "br_5123456789ABCDEFGHJKMNPQRS";

const PageRevisionRows = Schema.mutable(Schema.Array(PageRevisionRow));
const PageAuditEventRows = Schema.mutable(Schema.Array(Schema.Any));
const NullReturn: Schema.Schema<null, null, never> = Schema.Null;

type PageTitle = { readonly title: string };
type PageAuditEvent = {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly brainKey: string;
  readonly pageKey: string;
  readonly revisionKey: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly effectKey: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: number;
  readonly schemaVersion: number;
};
type RaceOutcome =
  | { readonly _tag: "Right" }
  | { readonly _tag: "Left"; readonly left: unknown };

const requireSchema = (
  name: string,
): Schema.Schema<unknown, unknown, never> => {
  const schema = schemaRegistry[name];
  if (schema === undefined) {
    throw new Error(`Missing schema registry entry: ${name}`);
  }
  return schema as Schema.Schema<unknown, unknown, never>;
};

const requireRevisionKey = (revisionKey: string | null): string => {
  if (revisionKey === null) {
    throw new Error("Expected page to have a current revision key");
  }
  return revisionKey;
};

const SeededBrain = Schema.Struct({
  organizationId: Id("organizations"),
  workspaceId: Id("workspaces"),
  userId: Id("users"),
});

type SeededBrain = Schema.Schema.Type<typeof SeededBrain>;

const seedBrain = (input: {
  readonly role: Role;
  readonly subject: string;
  readonly email: string;
  readonly brainKey: string;
  readonly status?: "active" | "archived";
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
        slug: input.brainKey.toLowerCase().replaceAll("_", "-"),
        status: "active",
        workosOrganizationId: `org_${input.subject}`,
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
        slug: `${input.brainKey.toLowerCase().replaceAll("_", "-")}-workspace`,
        status: input.status ?? "active",
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

    return { organizationId, workspaceId, userId };
  });

const seedMember = (input: {
  readonly organizationId: GenericId<"organizations">;
  readonly workspaceId: GenericId<"workspaces">;
  readonly role: Role;
  readonly subject: string;
  readonly email: string;
}): Effect.Effect<GenericId<"users">, never, DatabaseWriter> =>
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
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId: input.organizationId,
        userId,
        role: input.role,
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
        workspaceId: input.workspaceId,
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
    return userId;
  });

const seedDuplicateOrganizationBinding = (input: {
  readonly ownerUserId: GenericId<"users">;
  readonly brainKey: string;
  readonly workosOrganizationId: string;
}) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: input.ownerUserId,
        name: `${input.brainKey}-duplicate`,
        slug: `${input.brainKey.toLowerCase().replaceAll("_", "-")}-duplicate`,
        status: "active",
        workosOrganizationId: input.workosOrganizationId,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: input.ownerUserId,
        brainKey: input.brainKey,
        name: `${input.brainKey}-duplicate`,
        slug: `${input.brainKey.toLowerCase().replaceAll("_", "-")}-duplicate-workspace`,
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return null;
  });

const patchPageStatus = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly pageKey: string;
  readonly status: "redacted" | "purged";
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const rows = yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", input.workspaceId))
      .collect()
      .pipe(Effect.orDie);
    const row = rows.find((candidate) => candidate.pageKey === input.pageKey);
    if (row !== undefined) {
      yield* writer
        .table("brainPages")
        .patch(row._id, {
          status: input.status,
          lifecycle: {
            state: input.status,
            generation: 9,
            updatedAt: now,
            purgeAfter: null,
          },
        })
        .pipe(Effect.orDie);
    }
    return null;
  });

const seedForeignParent = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("brainPages")
      .insert({
        workspaceId,
        organizationId: "foreign-org",
        slug: "foreign",
        title: "Foreign",
        markdown: "# Foreign",
        sourceKind: "markdown",
        updatedAt: now,
        pageKey: "pag_foreign",
        parentPageKey: null,
        siblingSlug: "foreign",
        sortKey: "0000000001",
        favorite: false,
        status: "active",
        currentRevisionKey: "rev_foreign",
        lifecycle: {
          state: "active",
          generation: 1,
          updatedAt: now,
          purgeAfter: null,
        },
        createdAt: now,
        schemaVersion: 1,
      })
      .pipe(Effect.orDie);
    return null;
  });

const actor = (
  confect: TestConfect.TestConfect<typeof databaseSchema>,
  subject: string,
  email: string,
  orgSubject = subject,
) =>
  confect.withIdentity({
    subject,
    email,
    emailVerified: true,
    workosOrganizationId: `org_${orgSubject}`,
  });

const collectPageRevisions = (
  workspaceId: GenericId<"workspaces">,
  pageKey: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("pageRevisions")
      .index("by_page_created", (q) =>
        q.eq("workspaceId", workspaceId).eq("pageKey", pageKey),
      )
      .collect()
      .pipe(Effect.orDie);
    return rows.map(({ _id: id, _creationTime: creationTime, ...row }) => {
      void id;
      void creationTime;
      return row;
    });
  });

const collectWorkspaceRevisions = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("pageRevisions")
      .index("by_page_created", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .pipe(Effect.orDie);
    return rows.map(({ _id: id, _creationTime: creationTime, ...row }) => {
      void id;
      void creationTime;
      return row;
    });
  });

const collectWorkspaceRevisionKeys = (workspaceId: GenericId<"workspaces">) =>
  collectWorkspaceRevisions(workspaceId).pipe(
    Effect.map((rows) =>
      rows.map((row) => `${row.pageKey}:${row.revisionKey}:${row.effectKey}`),
    ),
  );

const pageMutationSnapshot = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const revisions = yield* collectWorkspaceRevisionKeys(workspaceId);
    const audits = yield* collectPageAuditEvents(workspaceId);
    return { revisions, audits };
  });

const collectPageAuditEvents = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("brainPageAuditEvents")
      .index("by_workspace_created", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return rows.map((row) => {
      const { _id: id, _creationTime: creationTime, ...event } = row as Record<
        string,
        unknown
      >;
      void id;
      void creationTime;
      return event;
    });
  });

describe("authorized Brain page CRUD", () => {
  it("keeps every pages manifest entry web-only", () => {
    expect(manifest).toHaveLength(7);
    for (const entry of manifest) {
      expect(entry.operationId).toMatch(/^brain\.pages\./);
      expect(entry.surfaces).toEqual(["web"]);
      expect(entry.surfaces).not.toEqual(
        expect.arrayContaining(["api", "cli", "mcp"]),
      );
    }
  });
  it("returns stable summaries and rejects forged caller tenant args", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "editor-subject",
          email: "editor@example.com",
          brainKey: editorBrainKey,
        }),
        SeededBrain,
      );
      const editor = actor(confect, "editor-subject", "editor@example.com");
      const page = yield* editor.mutation(refs.public.brain.pages.create, {
        brainKey: editorBrainKey,
        parentPageKey: null,
        siblingSlug: "brief",
        sortKey: "0000000001",
        title: "Client Brief",
        markdown: "# Client Brief",
        expectedCurrentRevisionKey: null,
      });
      const list = yield* editor.query(refs.public.brain.pages.list, {
        brainKey: editorBrainKey,
        includeArchived: false,
      });
      const detail = yield* editor.query(refs.public.brain.pages.get, {
        brainKey: editorBrainKey,
        pageKey: page.pageKey,
      });
      const revisions = yield* confect.run(
        collectPageRevisions(seeded.workspaceId, page.pageKey),
        PageRevisionRows,
      );
      return { page, list, detail, revisions };
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.page.pageKey).toMatch(/^pag_/);
    expect(requireRevisionKey(result.page.currentRevisionKey)).toMatch(/^rev_/);
    expect(result.list.pages).toHaveLength(1);
    expect(JSON.stringify(result.list)).not.toContain("workspaces_");
    expect(result.detail.markdown).toBe("# Client Brief");
    expect(() =>
      Schema.decodeUnknownSync(requireSchema("brain.pages.list.args"))(
        {
          brainKey: editorBrainKey,
          workspaceId: "forged",
        },
        { onExcessProperty: "error" },
      ),
    ).toThrow(/workspaceId/);
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]?.revisionKey).toBe(
      requireRevisionKey(result.page.currentRevisionKey),
    );
    expect(result.revisions[0]?.priorRevisionKey).toBeNull();
    expect(result.revisions[0]?.actor.kind).toBe("user");
    expect(result.revisions[0]?.effectKey).toContain("brain.pages.create");
  });

  it("records editor snapshots by stable keys and denies stale or foreign snapshots without mutating", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "snapshot-editor",
          email: "snapshot-editor@example.com",
          brainKey: editorBrainKey,
        }),
        SeededBrain,
      );
      const otherSeeded = yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "snapshot-other",
          email: "snapshot-other@example.com",
          brainKey: viewerBrainKey,
        }),
        SeededBrain,
      );
      const editor = actor(
        confect,
        "snapshot-editor",
        "snapshot-editor@example.com",
      );
      const page = yield* editor.mutation(refs.public.brain.pages.create, {
        brainKey: editorBrainKey,
        parentPageKey: null,
        siblingSlug: "snapshot-page",
        sortKey: "0000000001",
        title: "Snapshot Page",
        markdown: "# Snapshot Page",
        expectedCurrentRevisionKey: null,
      });
      const other = actor(
        confect,
        "snapshot-other",
        "snapshot-other@example.com",
      );
      yield* other.mutation(refs.public.brain.pages.create, {
        brainKey: viewerBrainKey,
        parentPageKey: null,
        siblingSlug: "other-page",
        sortKey: "0000000001",
        title: "Other Page",
        markdown: "# Other Page",
        expectedCurrentRevisionKey: null,
      });
      const before = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const saved = yield* editor.mutation(
        refs.internal.brain.pages.recordSnapshotInternal,
        {
          brainKey: editorBrainKey,
          pageKey: page.pageKey,
          expectedCurrentRevisionKey: requireRevisionKey(
            page.currentRevisionKey,
          ),
          snapshot: '{"type":"doc","content":[]}',
          version: 7,
        },
      );
      const afterSave = yield* editor.query(refs.public.brain.pages.get, {
        brainKey: editorBrainKey,
        pageKey: page.pageKey,
      });
      const afterSaveMutationRows = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const stale = yield* editor
        .mutation(refs.internal.brain.pages.recordSnapshotInternal, {
          brainKey: editorBrainKey,
          pageKey: page.pageKey,
          expectedCurrentRevisionKey: "rev_stale",
          snapshot: '{"type":"doc","stale":true}',
          version: 8,
        })
        .pipe(Effect.either);
      const staleVersion = yield* editor
        .mutation(refs.internal.brain.pages.recordSnapshotInternal, {
          brainKey: editorBrainKey,
          pageKey: page.pageKey,
          expectedCurrentRevisionKey: requireRevisionKey(
            page.currentRevisionKey,
          ),
          snapshot: '{"type":"doc","oldVersion":true}',
          version: 7,
        })
        .pipe(Effect.either);
      const crossBrain = yield* other
        .mutation(refs.internal.brain.pages.recordSnapshotInternal, {
          brainKey: viewerBrainKey,
          pageKey: page.pageKey,
          expectedCurrentRevisionKey: requireRevisionKey(
            page.currentRevisionKey,
          ),
          snapshot: '{"type":"doc","foreign":true}',
          version: 9,
        })
        .pipe(Effect.either);
      const afterDenials = yield* editor.query(refs.public.brain.pages.get, {
        brainKey: editorBrainKey,
        pageKey: page.pageKey,
      });
      const afterDeniedMutationRows = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const otherMutationRows = yield* confect.run(
        pageMutationSnapshot(otherSeeded.workspaceId),
        Schema.Any,
      );
      return {
        saved,
        before,
        afterSave,
        afterSaveMutationRows,
        stale,
        staleVersion,
        crossBrain,
        afterDenials,
        afterDeniedMutationRows,
        otherMutationRows,
      };
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.saved).toEqual({ ok: true });
    expect(result.afterSave.editorSnapshotJson).toBe(
      '{"type":"doc","content":[]}',
    );
    expect(result.afterSave.editorSnapshotVersion).toBe(7);
    expect(result.afterSave.page.currentRevisionKey).toBe(
      result.afterDenials.page.currentRevisionKey,
    );
    expect(result.afterSaveMutationRows).toEqual(result.before);
    expect(result.stale._tag).toBe("Left");
    expect(result.stale.left).toBeInstanceOf(StaleRevision);
    expect(result.staleVersion._tag).toBe("Left");
    expect(result.staleVersion.left).toBeInstanceOf(ValidationFailed);
    expect(result.crossBrain._tag).toBe("Left");
    expect(result.crossBrain.left).toBeInstanceOf(PageNotFound);
    expect(result.afterDenials.editorSnapshotJson).toBe(
      '{"type":"doc","content":[]}',
    );
    expect(result.afterDenials.editorSnapshotVersion).toBe(7);
    expect(result.afterDeniedMutationRows).toEqual(
      result.afterSaveMutationRows,
    );
    expect(result.otherMutationRows).toEqual({
      revisions: [expect.any(String)],
      audits: [expect.any(String)],
    });
    expect(() =>
      Schema.decodeUnknownSync(RecordSnapshotArgs)(
        {
          brainKey: editorBrainKey,
          pageKey: page.pageKey,
          expectedCurrentRevisionKey: requireRevisionKey(
            page.currentRevisionKey,
          ),
          workspaceId: seeded.workspaceId,
          snapshot: '{"type":"doc"}',
          version: 10,
        },
        { onExcessProperty: "error" },
      ),
    ).toThrow(/workspaceId/);
  });

  it("allows viewer reads and denies viewer writes with Forbidden", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "shared-editor",
          email: "shared-editor@example.com",
          brainKey: viewerBrainKey,
        }),
        SeededBrain,
      );
      yield* confect.run(
        seedMember({
          ...seeded,
          role: "viewer",
          subject: "viewer-subject",
          email: "viewer@example.com",
        }),
        Id("users"),
      );
      const editor = actor(
        confect,
        "shared-editor",
        "shared-editor@example.com",
      );
      const page = yield* editor.mutation(refs.public.brain.pages.create, {
        brainKey: viewerBrainKey,
        parentPageKey: null,
        siblingSlug: "visible",
        sortKey: "0000000001",
        title: "Visible",
        markdown: "# Visible",
        expectedCurrentRevisionKey: null,
      });
      const viewer = actor(
        confect,
        "viewer-subject",
        "viewer@example.com",
        "shared-editor",
      );
      const read = yield* viewer.query(refs.public.brain.pages.list, {
        brainKey: viewerBrainKey,
        includeArchived: false,
      });
      const detail = yield* viewer.query(refs.public.brain.pages.get, {
        brainKey: viewerBrainKey,
        pageKey: page.pageKey,
      });
      const beforeViewerWrite = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const viewerWrite = yield* viewer
        .mutation(refs.public.brain.pages.create, {
          brainKey: viewerBrainKey,
          parentPageKey: null,
          siblingSlug: "denied",
          sortKey: "0000000001",
          title: "Denied",
          markdown: "# Denied",
          expectedCurrentRevisionKey: null,
        })
        .pipe(Effect.flip);
      const afterViewerWrite = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      return { read, detail, viewerWrite, beforeViewerWrite, afterViewerWrite };
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.read.pages.map((page: PageTitle) => page.title)).toEqual([
      "Visible",
    ]);
    expect(result.detail.markdown).toBe("# Visible");
    expect(result.viewerWrite).toBeInstanceOf(Forbidden);
    expect(result.afterViewerWrite).toEqual(result.beforeViewerWrite);
  });

  it("separates archive success from stale, cycle, parent, and Brain lifecycle denials", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "editor-subject",
          email: "editor@example.com",
          brainKey: editorBrainKey,
        }),
        SeededBrain,
      );
      const editor = actor(confect, "editor-subject", "editor@example.com");
      const root = yield* editor.mutation(refs.public.brain.pages.create, {
        brainKey: editorBrainKey,
        parentPageKey: null,
        siblingSlug: "root",
        sortKey: "0000000001",
        title: "Root",
        markdown: "# Root",
        expectedCurrentRevisionKey: null,
      });
      const child = yield* editor.mutation(refs.public.brain.pages.create, {
        brainKey: editorBrainKey,
        parentPageKey: root.pageKey,
        siblingSlug: "child",
        sortKey: "0000000001",
        title: "Child",
        markdown: "# Child",
        expectedCurrentRevisionKey: null,
      });
      const beforeCycle = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const cycle = yield* editor
        .mutation(refs.public.brain.pages.move, {
          brainKey: editorBrainKey,
          pageKey: root.pageKey,
          parentPageKey: child.pageKey,
          sortKey: "0000000002",
          expectedCurrentRevisionKey: requireRevisionKey(
            root.currentRevisionKey,
          ),
        })
        .pipe(Effect.flip);
      const afterCycle = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const archived = yield* editor.mutation(refs.public.brain.pages.archive, {
        brainKey: editorBrainKey,
        pageKey: child.pageKey,
        expectedCurrentRevisionKey: requireRevisionKey(
          child.currentRevisionKey,
        ),
      });
      const redacted = yield* editor.mutation(refs.public.brain.pages.create, {
        brainKey: editorBrainKey,
        parentPageKey: null,
        siblingSlug: "redacted",
        sortKey: "0000000008",
        title: "Redacted",
        markdown: "# Redacted",
        expectedCurrentRevisionKey: null,
      });
      const purged = yield* editor.mutation(refs.public.brain.pages.create, {
        brainKey: editorBrainKey,
        parentPageKey: null,
        siblingSlug: "purged",
        sortKey: "0000000009",
        title: "Purged",
        markdown: "# Purged",
        expectedCurrentRevisionKey: null,
      });
      yield* confect.run(
        patchPageStatus({
          workspaceId: seeded.workspaceId,
          pageKey: redacted.pageKey,
          status: "redacted",
        }),
        NullReturn,
      );
      yield* confect.run(
        patchPageStatus({
          workspaceId: seeded.workspaceId,
          pageKey: purged.pageKey,
          status: "purged",
        }),
        NullReturn,
      );
      const defaultList = yield* editor.query(refs.public.brain.pages.list, {
        brainKey: editorBrainKey,
        includeArchived: false,
      });
      const archivedList = yield* editor.query(refs.public.brain.pages.list, {
        brainKey: editorBrainKey,
        includeArchived: true,
      });
      const renamed = yield* editor.mutation(refs.public.brain.pages.rename, {
        brainKey: editorBrainKey,
        pageKey: root.pageKey,
        title: "Fresh root",
        expectedCurrentRevisionKey: requireRevisionKey(root.currentRevisionKey),
      });
      const favored = yield* editor.mutation(refs.public.brain.pages.favorite, {
        brainKey: editorBrainKey,
        pageKey: root.pageKey,
        favorite: true,
        expectedCurrentRevisionKey: requireRevisionKey(
          renamed.currentRevisionKey,
        ),
      });
      const moved = yield* editor.mutation(refs.public.brain.pages.move, {
        brainKey: editorBrainKey,
        pageKey: root.pageKey,
        parentPageKey: null,
        sortKey: "0000000003",
        expectedCurrentRevisionKey: requireRevisionKey(
          favored.currentRevisionKey,
        ),
      });
      const rootRevisions = yield* confect.run(
        collectPageRevisions(seeded.workspaceId, root.pageKey),
        PageRevisionRows,
      );
      const childRevisions = yield* confect.run(
        collectPageRevisions(seeded.workspaceId, child.pageKey),
        PageRevisionRows,
      );
      const auditEventsBeforeDenials = yield* confect.run(
        collectPageAuditEvents(seeded.workspaceId),
        PageAuditEventRows,
      );
      const beforeStale = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const stale = yield* editor
        .mutation(refs.public.brain.pages.rename, {
          brainKey: editorBrainKey,
          pageKey: root.pageKey,
          title: "Stale root",
          expectedCurrentRevisionKey: requireRevisionKey(
            root.currentRevisionKey,
          ),
        })
        .pipe(Effect.flip);
      const afterStale = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const crossBrainSeed = yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "other-subject",
          email: "other@example.com",
          brainKey: "br_4123456789ABCDEFGHJKMNPQRS",
        }),
        SeededBrain,
      );
      yield* confect.run(
        seedForeignParent(crossBrainSeed.workspaceId),
        NullReturn,
      );
      const beforeCrossBrain = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const crossBrain = yield* editor
        .mutation(refs.public.brain.pages.move, {
          brainKey: editorBrainKey,
          pageKey: root.pageKey,
          parentPageKey: "pag_foreign",
          sortKey: "0000000002",
          expectedCurrentRevisionKey: requireRevisionKey(
            moved.currentRevisionKey,
          ),
        })
        .pipe(Effect.flip);
      const afterCrossBrain = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "archived-subject",
          email: "archived@example.com",
          brainKey: archivedBrainKey,
          status: "archived",
        }),
        SeededBrain,
      );
      const beforeArchivedBrain = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const archivedBrain = yield* actor(
        confect,
        "archived-subject",
        "archived@example.com",
      )
        .mutation(refs.public.brain.pages.create, {
          brainKey: archivedBrainKey,
          parentPageKey: null,
          siblingSlug: "denied",
          sortKey: "0000000001",
          title: "Denied",
          markdown: "# Denied",
          expectedCurrentRevisionKey: null,
        })
        .pipe(Effect.flip);
      const afterArchivedBrain = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const brainNotFound = yield* editor
        .query(refs.public.brain.pages.list, {
          brainKey: "br_3123456789ABCDEFGHJKMNPQRS",
        })
        .pipe(Effect.flip);
      const auditEventsAfterDenials = yield* confect.run(
        collectPageAuditEvents(seeded.workspaceId),
        PageAuditEventRows,
      );
      const workspaceRevisions = yield* confect.run(
        collectWorkspaceRevisions(seeded.workspaceId),
        PageRevisionRows,
      );
      return {
        root,
        child,
        redacted,
        purged,
        archived,
        stale,
        cycle,
        crossBrain,
        archivedBrain,
        brainNotFound,
        rootRevisions,
        childRevisions,
        moved,
        defaultList,
        archivedList,
        auditEventsBeforeDenials,
        auditEventsAfterDenials,
        workspaceRevisions,
        beforeCycle,
        afterCycle,
        beforeStale,
        afterStale,
        beforeCrossBrain,
        afterCrossBrain,
        beforeArchivedBrain,
        afterArchivedBrain,
        seeded,
      };
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.archived.status).toBe("archived");
    expect(result.stale).toBeInstanceOf(StaleRevision);
    expect(result.afterCycle).toEqual(result.beforeCycle);
    expect(result.afterStale).toEqual(result.beforeStale);
    expect(result.afterCrossBrain).toEqual(result.beforeCrossBrain);
    expect(result.afterArchivedBrain).toEqual(result.beforeArchivedBrain);
    expect(
      result.defaultList.pages.map((page: PageTitle) => page.title),
    ).toEqual(["Root"]);
    expect(
      result.archivedList.pages.map((page: PageTitle) => page.title).sort(),
    ).toEqual(["Child", "Root"].sort());
    expect(JSON.stringify(result.archivedList)).not.toContain("Redacted");
    expect(JSON.stringify(result.archivedList)).not.toContain("Purged");
    expect(
      result.rootRevisions.map((revision) => revision.revisionKey),
    ).toEqual([
      result.rootRevisions[0]?.revisionKey,
      result.rootRevisions[1]?.revisionKey,
      result.rootRevisions[2]?.revisionKey,
      requireRevisionKey(result.moved.currentRevisionKey),
    ]);
    expect(
      result.rootRevisions.map((revision) => revision.priorRevisionKey),
    ).toEqual([
      null,
      result.rootRevisions[0]?.revisionKey,
      result.rootRevisions[1]?.revisionKey,
      result.rootRevisions[2]?.revisionKey,
    ]);
    expect(result.rootRevisions.map((revision) => revision.effectKey)).toEqual([
      expect.stringContaining("brain.pages.create"),
      expect.stringContaining("brain.pages.rename"),
      expect.stringContaining("brain.pages.favorite"),
      expect.stringContaining("brain.pages.move"),
    ]);
    expect(
      result.rootRevisions.every((revision) => revision.actor.kind === "user"),
    ).toBe(true);
    expect(result.childRevisions).toHaveLength(2);
    expect(result.childRevisions[1]?.priorRevisionKey).toBe(
      result.childRevisions[0]?.revisionKey,
    );
    expect(result.childRevisions[1]?.effectKey).toContain(
      "brain.pages.archive",
    );
    const auditEvents = result.auditEventsBeforeDenials as PageAuditEvent[];
    expect(auditEvents.map((event) => event.action)).toEqual([
      "page.created",
      "page.created",
      "page.archived",
      "page.created",
      "page.created",
      "page.renamed",
      "page.favoriteChanged",
      "page.moved",
    ]);
    expect(result.auditEventsAfterDenials).toHaveLength(auditEvents.length);
    expect(
      auditEvents.map((event) => `${event.pageKey}:${event.revisionKey}`),
    ).toEqual([
      `${result.root.pageKey}:${requireRevisionKey(result.root.currentRevisionKey)}`,
      `${result.child.pageKey}:${requireRevisionKey(result.child.currentRevisionKey)}`,
      `${result.child.pageKey}:${requireRevisionKey(result.archived.currentRevisionKey)}`,
      expect.stringContaining(`${result.redacted.pageKey}:`),
      expect.stringContaining(`${result.purged.pageKey}:`),
      `${result.root.pageKey}:${result.rootRevisions[1]?.revisionKey}`,
      `${result.root.pageKey}:${result.rootRevisions[2]?.revisionKey}`,
      `${result.root.pageKey}:${requireRevisionKey(result.moved.currentRevisionKey)}`,
    ]);
    const effectKindByAction: Record<string, string> = {
      "page.created": "create",
      "page.renamed": "rename",
      "page.moved": "move",
      "page.favoriteChanged": "favorite",
      "page.archived": "archive",
    };
    const revisionCreatedAtByKey = new Map(
      result.workspaceRevisions.map((revision) => [
        `${revision.pageKey}:${revision.revisionKey}`,
        revision.createdAt,
      ]),
    );
    for (const event of auditEvents) {
      expect(event.workspaceId).toBe(String(result.seeded.workspaceId));
      expect(event.organizationId).toBe(String(result.seeded.organizationId));
      expect(event.brainKey).toBe(editorBrainKey);
      expect(event.actorUserId).toBe(String(result.seeded.userId));
      expect(event.schemaVersion).toBe(1);
      expect(event.createdAt).toBeGreaterThan(0);
      expect(event.effectKey).toBe(
        `brain.pages.${effectKindByAction[event.action]}:${event.pageKey}:${event.revisionKey}`,
      );
      expect(revisionCreatedAtByKey.has(`${event.pageKey}:${event.revisionKey}`)).toBe(
        true,
      );
      expect(event.createdAt).toBe(
        revisionCreatedAtByKey.get(`${event.pageKey}:${event.revisionKey}`),
      );
      expect(JSON.stringify(event.metadata)).not.toMatch(
        /Root|Child|Redacted|Purged|#|markdown|title|snapshot|request/i,
      );
    }
    expect(result.cycle).toBeInstanceOf(PageTreeConflict);
    expect(result.crossBrain).toBeInstanceOf(PageNotFound);
    expect(result.archivedBrain).toBeInstanceOf(LifecycleRevoked);
    expect(result.brainNotFound).toBeInstanceOf(BrainNotFound);
  });

  it("covers role matrix, conflicts, stale move race, and duplicate bindings", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedBrain({
          role: "owner",
          subject: "owner-subject",
          email: "owner@example.com",
          brainKey: matrixBrainKey,
        }),
        SeededBrain,
      );
      yield* confect.run(
        seedMember({
          ...seeded,
          role: "admin",
          subject: "admin-subject",
          email: "admin@example.com",
        }),
        Id("users"),
      );
      yield* confect.run(
        seedMember({
          ...seeded,
          role: "editor",
          subject: "matrix-editor",
          email: "matrix-editor@example.com",
        }),
        Id("users"),
      );
      yield* confect.run(
        seedMember({
          ...seeded,
          role: "viewer",
          subject: "matrix-viewer",
          email: "matrix-viewer@example.com",
        }),
        Id("users"),
      );
      const owner = actor(confect, "owner-subject", "owner@example.com");
      const page = yield* owner.mutation(refs.public.brain.pages.create, {
        brainKey: matrixBrainKey,
        parentPageKey: null,
        siblingSlug: "matrix",
        sortKey: "0000000001",
        title: "Matrix",
        markdown: "# Matrix",
        expectedCurrentRevisionKey: null,
      });
      const sibling = yield* owner.mutation(refs.public.brain.pages.create, {
        brainKey: matrixBrainKey,
        parentPageKey: null,
        siblingSlug: "sibling",
        sortKey: "0000000002",
        title: "Sibling",
        markdown: "# Sibling",
        expectedCurrentRevisionKey: null,
      });
      const roles = ["viewer", "editor", "admin", "owner"] as const;
      const subjects = {
        viewer: "matrix-viewer",
        editor: "matrix-editor",
        admin: "admin-subject",
        owner: "owner-subject",
      } as const;
      const matrix = yield* Effect.forEach(roles, (role) =>
        Effect.gen(function* () {
          const client = actor(
            confect,
            subjects[role],
            `${subjects[role]}@example.com`,
            "owner-subject",
          );
          const list = yield* client.query(refs.public.brain.pages.list, {
            brainKey: matrixBrainKey,
            includeArchived: false,
          });
          const get = yield* client.query(refs.public.brain.pages.get, {
            brainKey: matrixBrainKey,
            pageKey: page.pageKey,
          });
          if (role === "viewer") {
            const create = yield* client
              .mutation(refs.public.brain.pages.create, {
                brainKey: matrixBrainKey,
                parentPageKey: null,
                siblingSlug: "new-viewer",
                sortKey: "0000000010",
                title: "New viewer",
                markdown: "# viewer",
                expectedCurrentRevisionKey: null,
              })
              .pipe(Effect.flip);
            const rename = yield* client
              .mutation(refs.public.brain.pages.rename, {
                brainKey: matrixBrainKey,
                pageKey: page.pageKey,
                title: "Rename viewer",
                expectedCurrentRevisionKey: requireRevisionKey(
                  page.currentRevisionKey,
                ),
              })
              .pipe(Effect.flip);
            const move = yield* client
              .mutation(refs.public.brain.pages.move, {
                brainKey: matrixBrainKey,
                pageKey: page.pageKey,
                parentPageKey: null,
                sortKey: "0000000020",
                expectedCurrentRevisionKey: requireRevisionKey(
                  page.currentRevisionKey,
                ),
              })
              .pipe(Effect.flip);
            const favorite = yield* client
              .mutation(refs.public.brain.pages.favorite, {
                brainKey: matrixBrainKey,
                pageKey: page.pageKey,
                favorite: true,
                expectedCurrentRevisionKey: requireRevisionKey(
                  page.currentRevisionKey,
                ),
              })
              .pipe(Effect.flip);
            const archive = yield* client
              .mutation(refs.public.brain.pages.archive, {
                brainKey: matrixBrainKey,
                pageKey: page.pageKey,
                expectedCurrentRevisionKey: requireRevisionKey(
                  page.currentRevisionKey,
                ),
              })
              .pipe(Effect.flip);
            return {
              role,
              listCount: list.pages.length,
              markdown: get.markdown,
              writesAllowed: false,
              failures: [create, rename, move, favorite, archive],
            };
          }
          const created = yield* client.mutation(
            refs.public.brain.pages.create,
            {
              brainKey: matrixBrainKey,
              parentPageKey: null,
              siblingSlug: `new-${role}`,
              sortKey: `000000001${roles.indexOf(role)}`,
              title: `New ${role}`,
              markdown: `# ${role}`,
              expectedCurrentRevisionKey: null,
            },
          );
          const renamed = yield* client.mutation(
            refs.public.brain.pages.rename,
            {
              brainKey: matrixBrainKey,
              pageKey: created.pageKey,
              title: `Rename ${role}`,
              expectedCurrentRevisionKey: requireRevisionKey(
                created.currentRevisionKey,
              ),
            },
          );
          const movedRow = yield* client.mutation(
            refs.public.brain.pages.move,
            {
              brainKey: matrixBrainKey,
              pageKey: created.pageKey,
              parentPageKey: null,
              sortKey: `000000002${roles.indexOf(role)}`,
              expectedCurrentRevisionKey: requireRevisionKey(
                renamed.currentRevisionKey,
              ),
            },
          );
          const favored = yield* client.mutation(
            refs.public.brain.pages.favorite,
            {
              brainKey: matrixBrainKey,
              pageKey: created.pageKey,
              favorite: true,
              expectedCurrentRevisionKey: requireRevisionKey(
                movedRow.currentRevisionKey,
              ),
            },
          );
          const archivedRow = yield* client.mutation(
            refs.public.brain.pages.archive,
            {
              brainKey: matrixBrainKey,
              pageKey: created.pageKey,
              expectedCurrentRevisionKey: requireRevisionKey(
                favored.currentRevisionKey,
              ),
            },
          );
          return {
            role,
            listCount: list.pages.length,
            markdown: get.markdown,
            writesAllowed: archivedRow.status === "archived",
            failures: [],
          };
        }),
      );
      const editor = actor(
        confect,
        "matrix-editor",
        "matrix-editor@example.com",
        "owner-subject",
      );
      const beforeDuplicateSibling = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const duplicateSibling = yield* editor
        .mutation(refs.public.brain.pages.create, {
          brainKey: matrixBrainKey,
          parentPageKey: null,
          siblingSlug: "sibling",
          sortKey: "0000000099",
          title: "Duplicate",
          markdown: "# Duplicate",
          expectedCurrentRevisionKey: null,
        })
        .pipe(Effect.flip);
      const afterDuplicateSibling = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const racePage = yield* owner.mutation(refs.public.brain.pages.create, {
        brainKey: matrixBrainKey,
        parentPageKey: null,
        siblingSlug: "race",
        sortKey: "0000000029",
        title: "Race",
        markdown: "# Race",
        expectedCurrentRevisionKey: null,
      });
      const beforeRace = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const race = yield* Effect.all(
        [
          editor
            .mutation(refs.public.brain.pages.move, {
              brainKey: matrixBrainKey,
              pageKey: racePage.pageKey,
              parentPageKey: null,
              sortKey: "0000000030",
              expectedCurrentRevisionKey: requireRevisionKey(
                racePage.currentRevisionKey,
              ),
            })
            .pipe(Effect.either),
          editor
            .mutation(refs.public.brain.pages.move, {
              brainKey: matrixBrainKey,
              pageKey: racePage.pageKey,
              parentPageKey: null,
              sortKey: "0000000031",
              expectedCurrentRevisionKey: requireRevisionKey(
                racePage.currentRevisionKey,
              ),
            })
            .pipe(Effect.either),
        ],
        { concurrency: "unbounded" },
      );
      const afterRace = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const moved = yield* editor.mutation(refs.public.brain.pages.move, {
        brainKey: matrixBrainKey,
        pageKey: sibling.pageKey,
        parentPageKey: null,
        sortKey: "0000000030",
        expectedCurrentRevisionKey: requireRevisionKey(
          sibling.currentRevisionKey,
        ),
      });
      const beforeStaleMove = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const staleMove = yield* editor
        .mutation(refs.public.brain.pages.move, {
          brainKey: matrixBrainKey,
          pageKey: sibling.pageKey,
          parentPageKey: null,
          sortKey: "0000000031",
          expectedCurrentRevisionKey: requireRevisionKey(
            sibling.currentRevisionKey,
          ),
        })
        .pipe(Effect.flip);
      const afterStaleMove = yield* confect.run(
        pageMutationSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "dupe-owner",
          email: "dupe@example.com",
          brainKey: "br_6123456789ABCDEFGHJKMNPQRS",
        }),
        SeededBrain,
      );
      yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "dupe-owner",
          email: "dupe2@example.com",
          brainKey: "br_6123456789ABCDEFGHJKMNPQRS",
        }),
        SeededBrain,
      );
      const duplicateSubject = yield* actor(
        confect,
        "dupe-owner",
        "dupe@example.com",
      )
        .query(refs.public.brain.pages.list, {
          brainKey: "br_6123456789ABCDEFGHJKMNPQRS",
        })
        .pipe(Effect.flip);
      const dupeOrgSeed = yield* confect.run(
        seedBrain({
          role: "editor",
          subject: "dupe-org-a",
          email: "dupe-org-a@example.com",
          brainKey: "br_7123456789ABCDEFGHJKMNPQRS",
        }),
        SeededBrain,
      );
      yield* confect.run(
        seedDuplicateOrganizationBinding({
          ownerUserId: dupeOrgSeed.userId,
          brainKey: "br_7123456789ABCDEFGHJKMNPQRS",
          workosOrganizationId: "org_dupe-org-a",
        }),
        NullReturn,
      );
      const duplicateOrganization = yield* actor(
        confect,
        "dupe-org-a",
        "dupe-org-a@example.com",
      )
        .query(refs.public.brain.pages.list, {
          brainKey: "br_7123456789ABCDEFGHJKMNPQRS",
        })
        .pipe(Effect.flip);
      return {
        matrix,
        duplicateSibling,
        moved,
        staleMove,
        duplicateSubject,
        duplicateOrganization,
        race,
        beforeDuplicateSibling,
        afterDuplicateSibling,
        beforeRace,
        afterRace,
        beforeStaleMove,
        afterStaleMove,
      };
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    for (const row of result.matrix) {
      expect(row.listCount).toBeGreaterThan(0);
      expect(row.markdown).toBe("# Matrix");
      if (row.role === "viewer") {
        row.failures.forEach((failure) =>
          expect(failure).toBeInstanceOf(Forbidden),
        );
        expect(row.writesAllowed).toBe(false);
      } else {
        expect(row.writesAllowed).toBe(true);
      }
    }
    expect(result.duplicateSibling).toBeInstanceOf(PageTreeConflict);
    expect(result.afterDuplicateSibling).toEqual(result.beforeDuplicateSibling);
    expect(
      result.race.filter((outcome: RaceOutcome) => outcome._tag === "Right"),
    ).toHaveLength(1);
    const raceFailures = result.race.filter(
      (outcome: RaceOutcome) => outcome._tag === "Left",
    );
    expect(raceFailures).toHaveLength(1);
    expect(
      raceFailures[0]?._tag === "Left" ? raceFailures[0].left : null,
    ).toBeInstanceOf(StaleRevision);
    expect(result.afterRace.revisions).toHaveLength(
      result.beforeRace.revisions.length + 1,
    );
    expect(result.afterRace.audits).toHaveLength(
      result.beforeRace.audits.length + 1,
    );
    expect(result.moved.sortKey).toBe("0000000030");
    expect(result.staleMove).toBeInstanceOf(StaleRevision);
    expect(result.afterStaleMove).toEqual(result.beforeStaleMove);
    expect(result.duplicateSubject).toBeInstanceOf(Unauthorized);
    expect(result.duplicateOrganization).toBeInstanceOf(BrainNotFound);
  });
});
