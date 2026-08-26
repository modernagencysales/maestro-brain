import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { Id } from "../confect/_generated/id";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import {
  MemberNotInWorkspace,
  StaleRevision,
  ValidationFailed,
} from "../confect/errors";
import {
  SeededTenancy,
  seedTenancy,
  seedWorkspaceForMember,
} from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("brain pages Confect contract", () => {
  it("rejects a workspace outsider before creating a markdown page", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      return yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .mutation(refs.public.brain.pages.createMarkdown, {
          workspaceId: seeded.workspaceId,
          slug: "outsider-note",
          title: "Outsider Note",
          markdown: "# nope",
        })
        .pipe(Effect.flip);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toBeInstanceOf(MemberNotInWorkspace);
    expect(result._tag).toBe("MemberNotInWorkspace");
  });

  it("enforces unique page identities and imported-page ownership", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const manualId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "manual-icp",
          title: "Manual ICP",
          markdown: "# Manual ICP",
        },
      );
      const manual = yield* actor.query(refs.public.brain.pages.get, {
        workspaceId: seeded.workspaceId,
        pageId: manualId,
      });
      const duplicateSlug = yield* actor
        .mutation(refs.public.brain.pages.createMarkdown, {
          workspaceId: seeded.workspaceId,
          slug: "manual-icp",
          title: "Duplicate",
          markdown: "# Duplicate",
          importSourceKey: "cli-import:manual-icp",
        })
        .pipe(Effect.flip);
      const adopted = yield* actor.mutation(
        refs.public.brain.pages.updateMarkdown,
        {
          workspaceId: seeded.workspaceId,
          pageId: manualId,
          title: "Adopted ICP",
          markdown: "# Adopted ICP",
          adoptImportSourceKey: "cli-import:manual-icp",
          expectedUpdatedAt: manual.updatedAt,
        },
      );
      const importedId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "imported-icp",
          title: "Imported ICP",
          markdown: "# Imported ICP",
          importSourceKey: "cli-import:imported-icp",
        },
      );
      const imported = yield* actor.query(refs.public.brain.pages.get, {
        workspaceId: seeded.workspaceId,
        pageId: importedId,
      });
      const updated = yield* actor.mutation(
        refs.public.brain.pages.updateMarkdown,
        {
          workspaceId: seeded.workspaceId,
          pageId: importedId,
          title: "Updated ICP",
          markdown: "# Updated ICP",
          expectedImportSourceKey: "cli-import:imported-icp",
          expectedUpdatedAt: imported.updatedAt,
        },
      );
      const wrongOwner = yield* actor
        .mutation(refs.public.brain.pages.updateMarkdown, {
          workspaceId: seeded.workspaceId,
          pageId: importedId,
          markdown: "# Wrong owner",
          expectedImportSourceKey: "cli-import:someone-else",
          expectedUpdatedAt: updated.updatedAt,
        })
        .pipe(Effect.flip);
      return { duplicateSlug, adopted, imported, updated, wrongOwner };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.duplicateSlug).toBeInstanceOf(ValidationFailed);
    expect(result.adopted.importSourceKey).toBe("cli-import:manual-icp");
    expect(result.imported.importSourceKey).toBe("cli-import:imported-icp");
    expect(result.updated).toMatchObject({
      title: "Updated ICP",
      markdown: "# Updated ICP",
    });
    expect(result.wrongOwner).toBeInstanceOf(ValidationFailed);
  });

  it("persists revision-fenced page lifecycle", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const otherWorkspaceId = yield* confect.run(
        seedWorkspaceForMember({
          organizationId: seeded.organizationId,
          ownerUserId: seeded.memberUserId,
          name: "Other Workspace",
          slug: "other-workspace",
          now,
        }),
        Id("workspaces"),
      );
      const otherPageId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: otherWorkspaceId,
          slug: "private-note",
          title: "Other workspace note",
          markdown: "# Not visible here",
        },
      );
      const pageId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "launch-plan",
          title: "Launch plan",
          markdown: "# Version one",
        },
      );
      const created = yield* actor.query(refs.public.brain.pages.get, {
        workspaceId: seeded.workspaceId,
        pageId,
      });
      const updated = yield* actor.mutation(
        refs.public.brain.pages.updateMarkdown,
        {
          workspaceId: seeded.workspaceId,
          pageId,
          markdown: "# Version two",
          expectedUpdatedAt: created.updatedAt,
        },
      );
      const stale = yield* actor
        .mutation(refs.public.brain.pages.updateMarkdown, {
          workspaceId: seeded.workspaceId,
          pageId,
          markdown: "# Stale overwrite",
          expectedUpdatedAt: created.updatedAt,
        })
        .pipe(Effect.flip);
      const afterStale = yield* actor.query(refs.public.brain.pages.get, {
        workspaceId: seeded.workspaceId,
        pageId,
      });
      const renamed = yield* actor.mutation(refs.public.brain.pages.rename, {
        workspaceId: seeded.workspaceId,
        pageId,
        expectedUpdatedAt: updated.updatedAt,
        title: "Launch playbook",
      });
      const favorited = yield* actor.mutation(
        refs.public.brain.pages.favorite,
        {
          workspaceId: seeded.workspaceId,
          pageId,
          expectedUpdatedAt: renamed.updatedAt,
          favorite: true,
        },
      );
      const childId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "channels",
          title: "Channels",
          markdown: "# Channels",
        },
      );
      const child = yield* actor.query(refs.public.brain.pages.get, {
        workspaceId: seeded.workspaceId,
        pageId: childId,
      });
      const moved = yield* actor.mutation(refs.public.brain.pages.move, {
        workspaceId: seeded.workspaceId,
        pageId: childId,
        expectedUpdatedAt: child.updatedAt,
        parentPageId: pageId,
        sortKey: "0000000001",
      });
      const beforeRestore = yield* actor.query(
        refs.public.brain.pages.history,
        { workspaceId: seeded.workspaceId, pageId },
      );
      const createRevision = beforeRestore.find(
        (revision) => "pageId" in revision && revision.causation === "create",
      );
      if (createRevision === undefined || !("pageId" in createRevision))
        return yield* Effect.die("missing create revision");
      const archived = yield* actor.mutation(refs.public.brain.pages.archive, {
        workspaceId: seeded.workspaceId,
        pageId,
        expectedUpdatedAt: favorited.updatedAt,
      });
      const activePages = yield* actor.query(refs.public.brain.pages.list, {
        workspaceId: seeded.workspaceId,
      });
      const allPages = yield* actor.query(refs.public.brain.pages.list, {
        workspaceId: seeded.workspaceId,
        includeArchived: true,
      });
      const restored = yield* actor.mutation(refs.public.brain.pages.restore, {
        workspaceId: seeded.workspaceId,
        pageId,
        expectedUpdatedAt: archived.updatedAt,
        revisionUpdatedAt: createRevision.updatedAt,
      });
      const restoredActivePages = yield* actor.query(
        refs.public.brain.pages.list,
        { workspaceId: seeded.workspaceId },
      );
      const history = yield* actor.query(refs.public.brain.pages.history, {
        workspaceId: seeded.workspaceId,
        pageId,
      });

      return {
        pageId,
        otherPageId,
        stale,
        afterStale,
        moved,
        restored,
        restoredActivePages,
        archived,
        activePages,
        allPages,
        history,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.stale).toBeInstanceOf(StaleRevision);
    expect(result.afterStale.markdown).toBe("# Version two");
    expect(result.moved.parentPageId).toBe(result.pageId);
    expect(result.restored).toMatchObject({
      title: "Launch plan",
      markdown: "# Version one",
      favorite: false,
      status: "active",
    });
    expect(result.restoredActivePages.map(({ _id }) => _id)).toContain(
      result.pageId,
    );
    expect(result.archived.status).toBe("archived");
    expect(result.activePages.map(({ _id }) => _id)).not.toContain(
      result.pageId,
    );
    expect(result.allPages.map(({ _id }) => _id)).toContain(result.pageId);
    expect(result.allPages.map(({ _id }) => _id)).not.toContain(
      result.otherPageId,
    );
    expect(result.history.map(({ causation }) => causation)).toEqual([
      "restore",
      "archive",
      "favorite",
      "rename",
      "update",
      "create",
    ]);
  });
});
