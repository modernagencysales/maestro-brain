import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import { BrainFeedbackReportRow } from "../tables/brainFeedbackReports";
import {
  FeedbackDatabaseReader,
  FeedbackDatabaseWriter,
} from "./feedbackDatabase";
import type {
  FeedbackCitation,
  FeedbackReadinessCoverage,
  FeedbackReportInput,
  FeedbackReportResult,
  FeedbackSubmitter,
} from "./feedbackSchema";

type FeedbackReportRow = Schema.Schema.Type<typeof BrainFeedbackReportRow>;

export type FeedbackTenant = {
  readonly organizationId: GenericId<"organizations">;
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
};

const invalid = (field: string, message: string) =>
  new ValidationFailed({ field, message });

const citationIdentity = (citation: FeedbackCitation): string =>
  `${citation.publicationSetKey}\u0000${citation.entryKey}`;

const coverageIdentity = (coverage: FeedbackReadinessCoverage): string =>
  `${coverage.corpusKey}\u0000${coverage.connectorScopeKey}`;

const sortByIdentity = <Value>(
  values: readonly Value[],
  identity: (value: Value) => string,
): Value[] =>
  [...values].sort((left, right) => {
    const leftIdentity = identity(left);
    const rightIdentity = identity(right);
    return leftIdentity < rightIdentity
      ? -1
      : leftIdentity > rightIdentity
        ? 1
        : 0;
  });

const hasDuplicateIdentity = <Value>(
  values: readonly Value[],
  identity: (value: Value) => string,
): boolean => new Set(values.map(identity)).size !== values.length;

const canonicalCitation = (citation: FeedbackCitation) => ({
  publicationSetKey: citation.publicationSetKey,
  entryKey: citation.entryKey,
});

const canonicalCoverage = (coverage: FeedbackReadinessCoverage) => ({
  corpusKey: coverage.corpusKey,
  sourceKind: coverage.sourceKind,
  connectorScopeKey: coverage.connectorScopeKey,
  required: coverage.required,
  status: coverage.status,
  freshness: coverage.freshness,
  generations: {
    ...(coverage.generations.connection === undefined
      ? {}
      : { connection: coverage.generations.connection }),
    ...(coverage.generations.allowlist === undefined
      ? {}
      : { allowlist: coverage.generations.allowlist }),
    ...(coverage.generations.policy === undefined
      ? {}
      : { policy: coverage.generations.policy }),
    ...(coverage.generations.reconciliation === undefined
      ? {}
      : { reconciliation: coverage.generations.reconciliation }),
  },
  ...(coverage.lastObservedAt === undefined
    ? {}
    : { lastObservedAt: coverage.lastObservedAt }),
  ...(coverage.lastReconciledAt === undefined
    ? {}
    : { lastReconciledAt: coverage.lastReconciledAt }),
  unresolvedFailureCount: coverage.unresolvedFailureCount,
});

export const canonicalFeedbackPayload = (input: FeedbackReportInput) => ({
  requestId: input.requestId,
  candidateManifestHash: input.candidateManifestHash,
  citations: sortByIdentity(input.citations, citationIdentity).map(
    canonicalCitation,
  ),
  readiness: {
    asOf: input.readiness.asOf,
    coverage: sortByIdentity(input.readiness.coverage, coverageIdentity).map(
      canonicalCoverage,
    ),
  },
  category: input.category,
  disposition: input.disposition,
  ...(input.evaluationRerunKey === undefined
    ? {}
    : { evaluationRerunKey: input.evaluationRerunKey }),
});

export const feedbackPayloadHash = (input: FeedbackReportInput): string =>
  `sha256:${sha256Hex(JSON.stringify(canonicalFeedbackPayload(input)))}`;

export const feedbackReportKey = (input: {
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly idempotencyKey: string;
}): string =>
  `fbr_${sha256Hex(
    JSON.stringify({
      namespace: "brain.feedback.reportWrongOrStale.v1",
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      idempotencyKey: input.idempotencyKey,
    }),
  )}`;

const resultFor = (
  row: FeedbackReportRow,
  duplicate: boolean,
): FeedbackReportResult => ({
  reportKey: row.reportKey,
  duplicate,
  requestId: row.requestId,
  createdAt: row.createdAt,
});

const validateCitations = (
  tenant: FeedbackTenant,
  citations: readonly FeedbackCitation[],
) =>
  Effect.gen(function* () {
    const reader = yield* FeedbackDatabaseReader;
    for (const citation of citations) {
      const matches = yield* reader
        .table("retrievalEntries")
        .index("by_workspace_brain_publication_set_entry", (query) =>
          query
            .eq("workspaceId", tenant.workspaceId)
            .eq("brainKey", tenant.brainKey)
            .eq("publicationSetKey", citation.publicationSetKey)
            .eq("entryKey", citation.entryKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (
        matches.length !== 1 ||
        matches[0]?.organizationKey !== tenant.organizationKey
      )
        return yield* invalid(
          "citations",
          "Every citation must identify one exact entry in the authenticated Brain.",
        );
    }
  });

export const writeFeedbackReport = (input: {
  readonly tenant: FeedbackTenant;
  readonly actor: FeedbackSubmitter;
  readonly input: FeedbackReportInput;
  readonly createdAt: number;
}): Effect.Effect<
  FeedbackReportResult,
  ValidationFailed,
  FeedbackDatabaseReader | FeedbackDatabaseWriter
> =>
  Effect.gen(function* () {
    const tenant = input.tenant;
    if (input.input.brainKey !== tenant.brainKey)
      return yield* invalid(
        "brainKey",
        "Feedback must target the authenticated Brain.",
      );
    if (hasDuplicateIdentity(input.input.citations, citationIdentity))
      return yield* invalid("citations", "Citation tuples must be unique.");
    if (hasDuplicateIdentity(input.input.readiness.coverage, coverageIdentity))
      return yield* invalid(
        "readiness.coverage",
        "Readiness scopes must be unique.",
      );

    const reportKey = feedbackReportKey({
      workspaceId: tenant.workspaceId,
      brainKey: tenant.brainKey,
      idempotencyKey: input.input.idempotencyKey,
    });
    const payloadHash = feedbackPayloadHash(input.input);
    const reader = yield* FeedbackDatabaseReader;
    const existingRows = yield* reader
      .table("brainFeedbackReports")
      .index("by_workspace_idempotency", (query) =>
        query
          .eq("workspaceId", tenant.workspaceId)
          .eq("idempotencyKey", input.input.idempotencyKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const existing = Option.fromNullable(existingRows[0]).pipe(
      Option.getOrNull,
    );
    if (existingRows.length > 1)
      return yield* invalid(
        "idempotencyKey",
        "Feedback idempotency state is inconsistent.",
      );
    if (existing !== null) {
      if (
        existing.organizationId !== tenant.organizationId ||
        existing.organizationKey !== tenant.organizationKey ||
        existing.brainKey !== tenant.brainKey ||
        existing.reportKey !== reportKey ||
        existing.payloadHash !== payloadHash
      )
        return yield* invalid(
          "idempotencyKey",
          "The idempotency key was already used for different feedback.",
        );
      return resultFor(existing, true);
    }

    yield* validateCitations(tenant, input.input.citations);
    const payload = canonicalFeedbackPayload(input.input);
    const row: FeedbackReportRow = {
      schemaVersion: 1,
      organizationId: tenant.organizationId,
      organizationKey: tenant.organizationKey,
      workspaceId: tenant.workspaceId,
      brainKey: tenant.brainKey,
      reportKey,
      idempotencyKey: input.input.idempotencyKey,
      payloadHash,
      ...payload,
      submittedBy: input.actor,
      createdAt: input.createdAt,
    };
    const writer = yield* FeedbackDatabaseWriter;
    yield* writer.table("brainFeedbackReports").insert(row).pipe(Effect.orDie);
    return resultFor(row, false);
  });
