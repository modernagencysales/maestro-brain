import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  RETRIEVAL_ELIGIBILITY_FENCE_MAX,
  retrievalEligibilityFenceKey,
  type RetrievalEligibilityFenceKind,
  type RetrievalEligibilityFenceRef,
} from "./retrievalPublication";

export type EligibilityFenceIdentity = {
  readonly organizationKey: string;
  readonly kind: RetrievalEligibilityFenceKind;
  readonly controllerKey: string;
};

type EligibilityFenceState = {
  readonly ref: RetrievalEligibilityFenceRef;
  readonly eligible: boolean;
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

export const slackSourceLifecycleFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly sourceKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "lifecycle",
  controllerKey: `slack-source:${input.organizationKey}:${input.sourceKey}`,
});

export const slackPolicyFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly channelKey: string;
  readonly brainKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "policy",
  controllerKey: `slack-policy:${input.channelKey}:${input.brainKey}`,
});

export const transcriptUnitLifecycleFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly unitKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "lifecycle",
  controllerKey: `transcript-unit:${input.organizationKey}:${input.unitKey}`,
});

export const transcriptRouteFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly unitKey: string;
  readonly brainKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "route",
  controllerKey: `transcript-route:${input.unitKey}:${input.brainKey}`,
});

export const connectionFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly connectionKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "connection",
  controllerKey: `connection:${input.connectionKey}`,
});

export const connectorScopeFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "scope",
  controllerKey: `connector-scope:${input.connectorScopeKey}`,
});

export const connectorAllowlistFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly connectorScopeKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "allowlist",
  controllerKey: `connector-allowlist:${input.connectorScopeKey}`,
});

export const documentLifecycleFenceIdentity = (input: {
  readonly organizationKey: string;
  readonly documentObjectKey: string;
}): EligibilityFenceIdentity => ({
  organizationKey: input.organizationKey,
  kind: "lifecycle",
  controllerKey: `document-object:${input.organizationKey}:${input.documentObjectKey}`,
});

const loadEligibilityFence = (identity: EligibilityFenceIdentity) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const fenceKey = retrievalEligibilityFenceKey(identity);
    const rows = yield* reader
      .table("retrievalEligibilityFences")
      .index("by_organization_fence", (query) =>
        query
          .eq("organizationKey", identity.organizationKey)
          .eq("fenceKey", fenceKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (rows.length > 1)
      return yield* Effect.die(
        new Error(`EligibilityFenceDuplicate:${fenceKey}`),
      );
    const stored = Option.fromNullable(rows[0]).pipe(Option.getOrNull);
    if (
      stored !== null &&
      (stored.kind !== identity.kind ||
        stored.controllerKey !== identity.controllerKey)
    )
      return yield* Effect.die(
        new Error(`EligibilityFenceControllerMismatch:${fenceKey}`),
      );
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

export const eligibilityFenceRefsCurrentEffect = (input: {
  readonly organizationKey: string;
  readonly refs: readonly RetrievalEligibilityFenceRef[];
  readonly expectedIdentities?: readonly EligibilityFenceIdentity[];
}) =>
  Effect.gen(function* () {
    if (
      input.refs.length === 0 ||
      input.refs.length > RETRIEVAL_ELIGIBILITY_FENCE_MAX ||
      new Set(input.refs.map(({ fenceKey }) => fenceKey)).size !==
        input.refs.length ||
      new Set(input.refs.map(({ kind }) => kind)).size !== input.refs.length
    )
      return false;
    const expected = (input.expectedIdentities ?? []).map((identity) => ({
      ...identity,
      fenceKey: retrievalEligibilityFenceKey(identity),
    }));
    if (
      expected.length > 0 &&
      (expected.length !== input.refs.length ||
        !expected.every((identity) =>
          input.refs.some(
            (ref) =>
              ref.kind === identity.kind && ref.fenceKey === identity.fenceKey,
          ),
        ))
    )
      return false;
    const reader = yield* DatabaseReader;
    const rows = yield* Effect.all(
      input.refs.map(({ fenceKey }) =>
        reader
          .table("retrievalEligibilityFences")
          .index("by_organization_fence", (query) =>
            query
              .eq("organizationKey", input.organizationKey)
              .eq("fenceKey", fenceKey),
          )
          .take(2)
          .pipe(Effect.orDie),
      ),
    );
    return input.refs.every((ref, index) => {
      const matches = rows[index];
      const stored = matches?.[0];
      const expectedIdentity = expected.find(
        (identity) =>
          identity.kind === ref.kind && identity.fenceKey === ref.fenceKey,
      );
      return (
        matches?.length === 1 &&
        stored !== undefined &&
        stored.kind === ref.kind &&
        stored.eligibilityGeneration === ref.eligibilityGeneration &&
        stored.eligible &&
        (expected.length === 0 ||
          (expectedIdentity !== undefined &&
            stored.controllerKey === expectedIdentity.controllerKey))
      );
    });
  });

export const ensureEligibilityFenceEffect = (input: {
  readonly identity: EligibilityFenceIdentity;
  readonly eligible: boolean;
  readonly now: number;
}): Effect.Effect<
  EligibilityFenceState,
  never,
  DatabaseReader | DatabaseWriter
> =>
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
}): Effect.Effect<
  EligibilityFenceState,
  never,
  DatabaseReader | DatabaseWriter
> =>
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
