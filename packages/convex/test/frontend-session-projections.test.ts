import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { MemberNotInWorkspace } from "../confect/errors";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("authenticated frontend projections", () => {
  it("projects the authenticated user and only live workspaces", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      yield* confect.run(seedTenancy(now), SeededTenancy);
      return yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
        })
        .query(refs.public.auth.workspaces.me, {});
    });

    await expect(
      Effect.runPromise(program.pipe(Effect.provide(testConfectLayer()))),
    ).resolves.toMatchObject({
      email: "member@example.com",
      name: "Member",
      image: null,
      workspaces: [{ slug: "acme-demo", name: "Acme Workspace" }],
    });
  });

  it("scopes list and bySlug to live caller membership", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const outsider = confect.withIdentity({
        subject: "outsider-subject",
        email: "outsider@example.com",
      });
      const outsiderList = yield* outsider.query(
        refs.public.auth.workspaces.list,
        {},
      );
      const outsiderWorkspace = yield* outsider
        .query(refs.public.auth.workspaces.bySlug, { slug: "acme-demo" })
        .pipe(Effect.flip);
      return { seeded, outsiderList, outsiderWorkspace };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.outsiderList).toEqual([]);
    expect(result.outsiderWorkspace).toBeInstanceOf(MemberNotInWorkspace);
  });

  it("creates and updates an authorized workspace for onboarding", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const availableBefore = yield* actor.query(
        refs.public.auth.workspaces.slugAvailable,
        { slug: "northstar-client" },
      );
      const created = yield* actor.mutation(
        refs.public.auth.workspaces.create,
        { name: "Northstar Client", slug: "northstar-client" },
      );
      const availableAfter = yield* actor.query(
        refs.public.auth.workspaces.slugAvailable,
        { slug: "northstar-client" },
      );
      const updated = yield* actor.mutation(
        refs.public.auth.workspaces.update,
        {
          workspaceId: created.id,
          name: "Northstar Labs",
          slug: "northstar-labs",
        },
      );
      const listed = yield* actor.query(refs.public.auth.workspaces.list, {});
      return { availableBefore, availableAfter, created, updated, listed };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.availableBefore).toEqual({ available: true });
    expect(result.availableAfter).toEqual({ available: false });
    expect(result.created).toMatchObject({ slug: "northstar-client" });
    expect(result.updated).toMatchObject({
      name: "Northstar Labs",
      slug: "northstar-labs",
    });
    expect(result.listed.map(({ _id }) => _id)).toContain(result.created.id);
  });

  it("joins active workspace members to user profiles after authorization", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const members = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
        })
        .query(refs.public.access.members.list, {
          workspaceId: seeded.workspaceId,
        });
      return members;
    });

    await expect(
      Effect.runPromise(program.pipe(Effect.provide(testConfectLayer()))),
    ).resolves.toEqual([
      {
        id: expect.stringContaining("workspaceMembers"),
        email: "member@example.com",
        name: "Member",
        avatar: null,
        roles: ["editor"],
        status: "active",
      },
    ]);
  });

  it("rejects an outsider from member projection", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      return yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .query(refs.public.access.members.list, {
          workspaceId: seeded.workspaceId,
        })
        .pipe(Effect.flip);
    });

    await expect(
      Effect.runPromise(program.pipe(Effect.provide(testConfectLayer()))),
    ).resolves.toBeInstanceOf(MemberNotInWorkspace);
  });
});
