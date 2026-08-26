import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  InvitationNotAccessible,
  InvitationNotPending,
} from "../confect/errors";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("workspace invitation contract", () => {
  it("lets the invited identity inspect and accept the shared workspace", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(
        Effect.gen(function* () {
          const tenancy = yield* seedTenancy(now);
          const reader = yield* DatabaseReader;
          const writer = yield* DatabaseWriter;
          const membership = yield* reader
            .table("workspaceMembers")
            .index("by_workspace_user", (query) =>
              query
                .eq("workspaceId", tenancy.workspaceId)
                .eq("userId", tenancy.memberUserId),
            )
            .first()
            .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
          yield* writer
            .table("workspaceMembers")
            .patch(membership._id, { role: "admin", updatedAt: now })
            .pipe(Effect.orDie);
          return tenancy;
        }),
        SeededTenancy,
      );
      const invitationId = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
        })
        .mutation(refs.public.access.invitations.create, {
          workspaceId: seeded.workspaceId,
          email: "outsider@example.com",
          role: "editor",
        });
      const wrongIdentityError = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
        })
        .query(refs.public.access.invitations.view, { invitationId })
        .pipe(Effect.flip);
      const invite = yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .query(refs.public.access.invitations.view, { invitationId });
      const accepted = yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .mutation(refs.public.access.invitations.accept, { invitationId });
      const acceptedInviteError = yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .query(refs.public.access.invitations.view, { invitationId })
        .pipe(Effect.flip);
      const members = yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .query(refs.public.access.members.list, {
          workspaceId: seeded.workspaceId,
        });

      return {
        wrongIdentityError,
        invite,
        accepted,
        acceptedInviteError,
        members,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.wrongIdentityError).toBeInstanceOf(InvitationNotAccessible);
    expect(result.invite).toMatchObject({
      workspace: { slug: "acme-demo", name: "Acme Workspace" },
      invitedBy: "Member",
    });
    expect(result.accepted.workspaceId).toBe(result.invite.workspace.id);
    expect(result.acceptedInviteError).toBeInstanceOf(InvitationNotPending);
    expect(result.members).toContainEqual(
      expect.objectContaining({
        email: "outsider@example.com",
        roles: ["editor"],
        status: "active",
      }),
    );
  });
});
