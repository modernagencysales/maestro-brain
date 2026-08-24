import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { Id } from "../confect/_generated/id";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseWriter } from "../confect/_generated/services";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("grounded assistant Confect contract", () => {
  it("returns only exact current evidence from the authorized workspace", async () => {
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
              slug: "other-workspace-grounding",
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
      const currentPageId = yield* actor.mutation(
        refs.public.brain.pages.createMarkdown,
        {
          workspaceId: seeded.workspaceId,
          slug: "acme-launch",
          title: "Acme launch plan",
          markdown: "Acme launches the customer portal on Friday.",
        },
      );
      yield* actor.mutation(refs.public.brain.pages.createMarkdown, {
        workspaceId: otherWorkspaceId,
        slug: "acme-secret",
        title: "Acme secret plan",
        markdown: "Acme launches the unreleased product on Monday.",
      });

      return yield* actor
        .query(refs.public.agents.assistant.answerQuestion, {
          workspaceId: seeded.workspaceId,
          question: "When does Acme launch the customer portal?",
        })
        .pipe(Effect.map((answer) => ({ answer, currentPageId })));
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.answer.status).toBe("answered");
    expect(result.answer.answerMarkdown).toContain("Friday");
    expect(result.answer.contextPack).toMatchObject({
      schemaVersion: "3",
      candidateManifest: { schemaVersion: "2" },
    });
    expect(result.answer.contextPack.citations).toEqual([
      expect.objectContaining({
        pageId: result.currentPageId,
        excerpt: "Acme launches the customer portal on Friday.",
      }),
    ]);
    expect(result.answer.answerMarkdown).not.toContain("Monday");
  });
});
