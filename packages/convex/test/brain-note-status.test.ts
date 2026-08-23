import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { testConfectLayer } from "./support/confect";
import { SeededBrainSchema, seedBrain } from "./support/brainPilotFixtures";

const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";

describe("headless Brain note status", () => {
  it("returns review metadata before and after an editor decision", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "note-status-editor",
            email: "note-status-editor@example.com",
            brainKey,
          }),
          SeededBrainSchema,
        );
        const input = {
          brainKey,
          organizationId: seeded.organizationId,
          workspaceId: seeded.workspaceId,
          title: "Terminal contribution",
          markdown: "Status should not expose this body.",
          idempotencyKey: "note.status-test",
        } as const;
        const submitted = yield* confect.mutation(
          refs.internal.brain.pilot.headlessSubmitNote,
          input,
        );
        const statusInput = {
          brainKey,
          organizationId: seeded.organizationId,
          workspaceId: seeded.workspaceId,
          sourceKey: submitted.sourceKey,
        } as const;
        const pending = yield* confect.query(
          refs.internal.brain.noteStatus.get,
          statusInput,
        );
        const editor = confect.withIdentity({
          subject: "note-status-editor",
          email: "note-status-editor@example.com",
          emailVerified: true,
          workosOrganizationId: "org_note-status-editor",
        });
        yield* editor.mutation(refs.public.brain.pilot.reviewNote, {
          brainKey,
          sourceKey: submitted.sourceKey,
          decision: "reject",
        });
        const rejected = yield* confect.query(
          refs.internal.brain.noteStatus.get,
          statusInput,
        );
        return { pending, rejected };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.pending).toMatchObject({
      title: "Terminal contribution",
      status: "pending_review",
      reviewedAt: null,
    });
    expect(result.rejected).toMatchObject({
      sourceKey: result.pending.sourceKey,
      title: "Terminal contribution",
      status: "rejected",
      reviewedAt: expect.any(Number),
    });
    expect(result.pending).not.toHaveProperty("markdown");
    expect(result.rejected).not.toHaveProperty("markdown");
  });
});
