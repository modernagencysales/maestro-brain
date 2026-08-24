import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { Id } from "../confect/_generated/id";
import { DatabaseWriter } from "../confect/_generated/services";
import { MemberNotInWorkspace, StaleRevision } from "../confect/errors";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
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

  it("persists revision-fenced page lifecycle", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const otherWorkspaceId = yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const workspaceId = yield* writer
            .table("workspaces")
            .insert({
              organizationId: seeded.organizationId,
              ownerUserId: seeded.memberUserId,
              name: "Other Workspace",
              slug: "other-workspace",
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
              userId: seeded.memberUserId,
              role: "editor",
              status: "active",
              acceptedAt: now,
              revokedAt: null,
              deletedAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          return workspaceId;
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
        ({ causation }) => causation === "create",
      );
      if (createRevision === undefined)
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
