import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("terminal workspace linking", () => {
  it("creates, lists, and revokes a workspace-bound terminal key", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });

      const created = yield* actor.mutation(
        refs.public.headless.apiKeys.createLinkedKey,
        {
          workspaceId: seeded.workspaceId,
          name: "Tim's MacBook",
        },
      );
      const beforeRevoke = yield* actor.query(
        refs.public.headless.apiKeys.listLinkedKeys,
        { workspaceId: seeded.workspaceId },
      );
      yield* actor.mutation(refs.public.headless.apiKeys.revokeLinkedKey, {
        workspaceId: seeded.workspaceId,
        keyId: created.key.id,
      });
      const afterRevoke = yield* actor.query(
        refs.public.headless.apiKeys.listLinkedKeys,
        { workspaceId: seeded.workspaceId },
      );

      return { created, beforeRevoke, afterRevoke };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.created.displayKey).toMatch(/^mtk_live_[A-Za-z0-9_-]+$/u);
    expect(result.created.key).toMatchObject({
      name: "Tim's MacBook",
      scopes: ["workspace:read", "workspace:write"],
      status: "active",
    });
    expect(result.beforeRevoke).toEqual([result.created.key]);
    expect(result.afterRevoke).toEqual([
      expect.objectContaining({
        id: result.created.key.id,
        status: "revoked",
      }),
    ]);
  });
});
