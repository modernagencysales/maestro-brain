import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  retrievalEligibilityFenceKey,
  type RetrievalEligibilityFenceKind,
  type RetrievalEligibilityFenceRef,
} from "./retrievalPublication";

export type EligibilityFenceIdentity = {
  readonly organizationKey: string;
  readonly kind: RetrievalEligibilityFenceKind;
  readonly controllerKey: string;
};

export const pageLifecycleFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly pageKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "lifecycle",
  controllerKey: `page:${input.workspaceId}:${input.pageKey}`,
});

const loadEligibilityFence = (identity: EligibilityFenceIdentity) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const fenceKey = retrievalEligibilityFenceKey(identity);
    const stored = yield* reader
      .table("retrievalEligibilityFences")
      .index("by_organization_fence", (query) =>
        query
          .eq("organizationKey", identity.organizationKey)
          .eq("fenceKey", fenceKey),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    return { fenceKey, stored };
  });

const toFenceRef = (input: {
  readonly kind: RetrievalEligibilityFenceKind;
  readonly fenceKey: string;
  readonly eligibilityGeneration: number;
}): RetrievalEligibilityFenceRef => ({
  kind: input.kind,
  fenceKey: input.fenceKey,
  eligibilityGeneration: input.eligibilityGeneration,
});

export const ensureEligibilityFenceEffect = (input: {
  readonly identity: EligibilityFenceIdentity;
  readonly eligible: boolean;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const { fenceKey, stored } = yield* loadEligibilityFence(input.identity);
    if (stored !== null)
      return {
        ref: toFenceRef(stored),
        eligible: stored.eligible,
      };
    const eligibilityGeneration = 1;
    yield* writer
      .table("retrievalEligibilityFences")
      .insert({
        schemaVersion: 1,
        organizationKey: input.identity.organizationKey,
        fenceKey,
        kind: input.identity.kind,
        controllerKey: input.identity.controllerKey,
        eligibilityGeneration,
        eligible: input.eligible,
        updatedAt: input.now,
      })
      .pipe(Effect.orDie);
    return {
      ref: toFenceRef({
        kind: input.identity.kind,
        fenceKey,
        eligibilityGeneration,
      }),
      eligible: input.eligible,
    };
  });

export const transitionEligibilityFenceEffect = (input: {
  readonly identity: EligibilityFenceIdentity;
  readonly eligible: boolean;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const { stored } = yield* loadEligibilityFence(input.identity);
    if (stored === null) return yield* ensureEligibilityFenceEffect(input);
    if (stored.eligible === input.eligible)
      return { ref: toFenceRef(stored), eligible: stored.eligible };
    const eligibilityGeneration = stored.eligibilityGeneration + 1;
    yield* writer
      .table("retrievalEligibilityFences")
      .patch(stored._id, {
        eligibilityGeneration,
        eligible: input.eligible,
        updatedAt: input.now,
      })
      .pipe(Effect.orDie);
    return {
      ref: toFenceRef({
        kind: stored.kind,
        fenceKey: stored.fenceKey,
        eligibilityGeneration,
      }),
      eligible: input.eligible,
    };
  });
