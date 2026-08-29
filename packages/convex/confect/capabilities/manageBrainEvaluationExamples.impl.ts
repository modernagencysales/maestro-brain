import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import type { BrainEvaluationExamplesDoc } from "../_generated/docs";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { ValidationFailed } from "../errors";
import {
  buildRedactedEvaluationExport,
  HOLDOUT_EXAMPLE_COUNT,
  MAX_EVALUATION_EXAMPLES,
  MAX_EVIDENCE_REFERENCES,
  selectEvaluationHoldout,
  type EvaluationEvidenceReference,
} from "./manageBrainEvaluationExamples.domain";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "./_kit/workspaceAccess";
import group from "./manageBrainEvaluationExamples.spec";

const invalid = (field: string, message: string) =>
  new ValidationFailed({ field, message });
const withClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

type EvaluationExample = BrainEvaluationExamplesDoc;

const requireAccess = (
  workspaceId: GenericId<"workspaces">,
  role: "viewer" | "editor",
  actorUserId?: GenericId<"users">,
) =>
  actorUserId === undefined
    ? withClock(requireWorkspaceAccess(workspaceId, role))
    : withClock(requireWorkspaceActorAccess(workspaceId, actorUserId, role));

const normalizedExample = (
  example: EvaluationExample,
  includeHoldoutGold = false,
) => ({
  evaluationExampleId: example._id,
  exampleKey: example.exampleKey,
  question: example.question,
  purpose: example.purpose,
  evidenceMode: example.evidenceMode,
  surface: example.surface,
  answerStatus: example.answerStatus,
  packHash: example.packHash,
  ...(example.maxCitations === undefined
    ? {}
    : { maxCitations: example.maxCitations }),
  ...(example.capturedAsOf === undefined
    ? {}
    : { capturedAsOf: example.capturedAsOf }),
  ...(example.policyVersion === undefined
    ? {}
    : { policyVersion: example.policyVersion }),
  evidenceReferences: [...example.evidenceReferences],
  captureKind: example.captureKind,
  usefulness: example.usefulness,
  ...(example.issueReason === undefined
    ? {}
    : { issueReason: example.issueReason }),
  adjudicationState: example.adjudicationState ?? ("pending" as const),
  ...(example.split === "holdout" && !includeHoldoutGold
    ? {}
    : {
        ...(example.expectedAnswerStatus === undefined
          ? {}
          : { expectedAnswerStatus: example.expectedAnswerStatus }),
        ...(example.riskLevel === undefined
          ? {}
          : { riskLevel: example.riskLevel }),
      }),
  expectedEvidenceReferences:
    example.split === "holdout" && !includeHoldoutGold
      ? []
      : [...(example.expectedEvidenceReferences ?? [])],
  ...(example.adjudicatedAt === undefined
    ? {}
    : { adjudicatedAt: example.adjudicatedAt }),
  split: example.split,
  ...(example.freezeKey === undefined ? {} : { freezeKey: example.freezeKey }),
  ...(example.freezePreviewHash === undefined
    ? {}
    : { freezePreviewHash: example.freezePreviewHash }),
  ...(example.freezeCutoffCreatedAt === undefined
    ? {}
    : { freezeCutoffCreatedAt: example.freezeCutoffCreatedAt }),
  ...(example.frozenAt === undefined ? {} : { frozenAt: example.frozenAt }),
  createdAt: example.createdAt,
  updatedAt: example.updatedAt,
});

const readWorkspaceExamples = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const rows = yield* (yield* DatabaseReader)
      .table("brainEvaluationExamples")
      .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(MAX_EVALUATION_EXAMPLES + 1)
      .pipe(Effect.orDie);
    if (rows.length > MAX_EVALUATION_EXAMPLES)
      return yield* invalid(
        "workspaceId",
        `Evaluation examples exceed the bounded ${MAX_EVALUATION_EXAMPLES}-row pilot capacity.`,
      );
    return rows;
  });

const exampleByKey = (
  workspaceId: GenericId<"workspaces">,
  rawExampleKey: string,
) =>
  Effect.gen(function* () {
    const exampleKey = rawExampleKey.trim();
    if (exampleKey.length === 0 || exampleKey.length > 200)
      return yield* invalid(
        "exampleKey",
        "Example key must contain between 1 and 200 characters.",
      );
    const matches = yield* (yield* DatabaseReader)
      .table("brainEvaluationExamples")
      .index("by_workspace_and_example_key", (q) =>
        q.eq("workspaceId", workspaceId).eq("exampleKey", exampleKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (matches.length !== 1 || matches[0] === undefined)
      return yield* invalid(
        "exampleKey",
        "Evaluation example was not found uniquely in this workspace.",
      );
    return matches[0];
  });

type ListArgs = {
  readonly workspaceId: GenericId<"workspaces">;
  readonly split?: "development" | "holdout" | undefined;
  readonly adjudicationState?: "pending" | "adjudicated" | undefined;
  readonly captureKind?: "feedback" | "test" | undefined;
  readonly limit?: number | undefined;
  readonly cursorCreatedAt?: number | undefined;
  readonly cursorExampleKey?: string | undefined;
  readonly includeHoldoutGold?: boolean | undefined;
};

const listExamples = (args: ListArgs, actorUserId?: GenericId<"users">) =>
  Effect.gen(function* () {
    yield* requireAccess(
      args.workspaceId,
      args.includeHoldoutGold === true ? "editor" : "viewer",
      actorUserId,
    );
    const limit = args.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return yield* invalid("limit", "List limit must be between 1 and 100.");
    if (
      (args.cursorCreatedAt === undefined) !==
      (args.cursorExampleKey === undefined)
    )
      return yield* invalid(
        "cursorCreatedAt",
        "Both cursorCreatedAt and cursorExampleKey are required together.",
      );
    if (
      args.cursorCreatedAt !== undefined &&
      (!Number.isFinite(args.cursorCreatedAt) ||
        args.cursorCreatedAt < 0 ||
        args.cursorExampleKey === undefined ||
        args.cursorExampleKey.length < 1 ||
        args.cursorExampleKey.length > 200)
    )
      return yield* invalid("cursorCreatedAt", "Evaluation cursor is invalid.");
    const matched = (yield* readWorkspaceExamples(args.workspaceId))
      .filter(
        (example) =>
          (args.split === undefined || example.split === args.split) &&
          (args.adjudicationState === undefined ||
            (example.adjudicationState ?? "pending") ===
              args.adjudicationState) &&
          (args.captureKind === undefined ||
            example.captureKind === args.captureKind) &&
          (args.cursorCreatedAt === undefined ||
            example.createdAt > args.cursorCreatedAt ||
            (example.createdAt === args.cursorCreatedAt &&
              example.exampleKey.localeCompare(args.cursorExampleKey ?? "") >
                0)),
      )
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.exampleKey.localeCompare(right.exampleKey),
      )
      .slice(0, limit + 1);
    const page = matched.slice(0, limit);
    const last = page.at(-1);
    return {
      examples: page.map((example) =>
        normalizedExample(example, args.includeHoldoutGold === true),
      ),
      ...(matched.length <= limit || last === undefined
        ? {}
        : {
            nextCursorCreatedAt: last.createdAt,
            nextCursorExampleKey: last.exampleKey,
          }),
    };
  });

const getExample = (
  args: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly exampleKey: string;
    readonly includeHoldoutGold?: boolean | undefined;
  },
  actorUserId?: GenericId<"users">,
) =>
  Effect.gen(function* () {
    yield* requireAccess(
      args.workspaceId,
      args.includeHoldoutGold === true ? "editor" : "viewer",
      actorUserId,
    );
    return normalizedExample(
      yield* exampleByKey(args.workspaceId, args.exampleKey),
      args.includeHoldoutGold === true,
    );
  });

const validateReferences = (
  workspaceId: GenericId<"workspaces">,
  references: readonly EvaluationEvidenceReference[],
) =>
  Effect.gen(function* () {
    if (references.length > MAX_EVIDENCE_REFERENCES)
      return yield* invalid(
        "expectedEvidenceReferences",
        `At most ${MAX_EVIDENCE_REFERENCES} expected evidence references are allowed.`,
      );
    const seen = new Set<string>();
    const reader = yield* DatabaseReader;
    for (const reference of references) {
      if (
        reference.sourceKey.length < 1 ||
        reference.sourceKey.length > 1_000 ||
        reference.revisionKey.length < 1 ||
        reference.revisionKey.length > 1_000 ||
        reference.contentHash.length < 1 ||
        reference.contentHash.length > 200
      )
        return yield* invalid(
          "expectedEvidenceReferences",
          "Expected evidence reference fields exceed their bounded size.",
        );
      const identity = `${reference.sourceKey}\u0000${reference.revisionKey}`;
      if (seen.has(identity))
        return yield* invalid(
          "expectedEvidenceReferences",
          "Expected evidence references must be unique.",
        );
      seen.add(identity);
      const matches = yield* reader
        .table("brainEvidenceRevisions")
        .index("by_workspace_and_source_key_and_revision_key", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .eq("sourceKey", reference.sourceKey)
            .eq("revisionKey", reference.revisionKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      if (
        matches.length !== 1 ||
        matches[0]?.contentHash !== reference.contentHash
      )
        return yield* invalid(
          "expectedEvidenceReferences",
          "An expected evidence reference could not be reopened exactly.",
        );
    }
  });

type AdjudicateArgs = {
  readonly workspaceId: GenericId<"workspaces">;
  readonly exampleKey: string;
  readonly expectedUpdatedAt: number;
  readonly expectedAnswerStatus: "answered" | "insufficient-context";
  readonly expectedEvidenceReferences: readonly EvaluationEvidenceReference[];
  readonly riskLevel: "ordinary" | "high";
};

const adjudicateExample = (
  args: AdjudicateArgs,
  actorUserId?: GenericId<"users">,
) =>
  Effect.gen(function* () {
    const access = yield* requireAccess(
      args.workspaceId,
      "editor",
      actorUserId,
    );
    const example = yield* exampleByKey(args.workspaceId, args.exampleKey);
    const repeatedAdjudication =
      example.adjudicationState === "adjudicated" &&
      example.expectedAnswerStatus === args.expectedAnswerStatus &&
      example.riskLevel === args.riskLevel &&
      JSON.stringify(example.expectedEvidenceReferences ?? []) ===
        JSON.stringify(args.expectedEvidenceReferences);
    if (repeatedAdjudication) return normalizedExample(example, true);
    if (example.split === "holdout")
      return yield* invalid(
        "exampleKey",
        "Frozen holdout examples are immutable.",
      );
    if (
      !Number.isFinite(args.expectedUpdatedAt) ||
      args.expectedUpdatedAt !== example.updatedAt
    )
      return yield* invalid(
        "expectedUpdatedAt",
        "Evaluation example changed after it was opened.",
      );
    if (
      args.expectedAnswerStatus === "answered" &&
      args.expectedEvidenceReferences.length === 0
    )
      return yield* invalid(
        "expectedEvidenceReferences",
        "Expected answered examples require supporting evidence.",
      );
    if (
      args.expectedAnswerStatus === "insufficient-context" &&
      args.expectedEvidenceReferences.length > 0
    )
      return yield* invalid(
        "expectedEvidenceReferences",
        "Expected insufficient-context examples cannot declare supporting evidence.",
      );
    yield* validateReferences(
      args.workspaceId,
      args.expectedEvidenceReferences,
    );
    const now = yield* withClock(Clock.currentTimeMillis);
    const updatedAt = Math.max(now, example.updatedAt + 1);
    const userId = access.userId;
    yield* (yield* DatabaseWriter)
      .table("brainEvaluationExamples")
      .patch(example._id, {
        adjudicationState: "adjudicated",
        expectedAnswerStatus: args.expectedAnswerStatus,
        expectedEvidenceReferences: [...args.expectedEvidenceReferences],
        riskLevel: args.riskLevel,
        adjudicatedAt: now,
        adjudicatedByUserId: userId,
        updatedAt,
      })
      .pipe(Effect.orDie);
    return normalizedExample(
      {
        ...example,
        adjudicationState: "adjudicated",
        expectedAnswerStatus: args.expectedAnswerStatus,
        expectedEvidenceReferences: [...args.expectedEvidenceReferences],
        riskLevel: args.riskLevel,
        adjudicatedAt: now,
        adjudicatedByUserId: userId,
        updatedAt,
      },
      true,
    );
  });

const freezePreview = (
  args: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly cutoffCreatedAt: number;
  },
  actorUserId?: GenericId<"users">,
) =>
  Effect.gen(function* () {
    yield* requireAccess(args.workspaceId, "viewer", actorUserId);
    if (!Number.isFinite(args.cutoffCreatedAt) || args.cutoffCreatedAt < 0)
      return yield* invalid(
        "cutoffCreatedAt",
        "Freeze cutoff must be a non-negative timestamp.",
      );
    return selectEvaluationHoldout(
      yield* readWorkspaceExamples(args.workspaceId),
      args.cutoffCreatedAt,
    );
  });

type ApplyFreezeArgs = {
  readonly workspaceId: GenericId<"workspaces">;
  readonly cutoffCreatedAt: number;
  readonly expectedPreviewHash: string;
  readonly freezeKey: string;
};

const applyFreeze = (args: ApplyFreezeArgs, actorUserId?: GenericId<"users">) =>
  Effect.gen(function* () {
    const access = yield* requireAccess(
      args.workspaceId,
      "editor",
      actorUserId,
    );
    const freezeKey = args.freezeKey.trim();
    if (freezeKey.length < 1 || freezeKey.length > 200)
      return yield* invalid(
        "freezeKey",
        "Freeze key must contain between 1 and 200 characters.",
      );
    if (!/^sha256:[a-f0-9]{64}$/u.test(args.expectedPreviewHash))
      return yield* invalid(
        "expectedPreviewHash",
        "Expected preview hash must be a canonical SHA-256 identifier.",
      );
    const examples = yield* readWorkspaceExamples(args.workspaceId);
    const prior = examples
      .filter((example) => example.freezeKey === freezeKey)
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.exampleKey.localeCompare(right.exampleKey),
      );
    if (prior.length > 0) {
      if (
        prior.length !== HOLDOUT_EXAMPLE_COUNT ||
        prior.some(
          (example) =>
            example.split !== "holdout" ||
            example.freezePreviewHash !== args.expectedPreviewHash ||
            example.freezeCutoffCreatedAt !== args.cutoffCreatedAt ||
            example.frozenAt !== prior[0]?.frozenAt,
        )
      )
        return yield* invalid(
          "freezeKey",
          "Freeze key was already used for a different or incomplete freeze.",
        );
      return {
        freezeKey,
        frozenAt: prior[0]?.frozenAt ?? 0,
        previewHash: args.expectedPreviewHash,
        selectedExampleKeys: prior.map(({ exampleKey }) => exampleKey),
      };
    }
    if (!Number.isFinite(args.cutoffCreatedAt) || args.cutoffCreatedAt < 0)
      return yield* invalid(
        "cutoffCreatedAt",
        "Freeze cutoff must be a non-negative timestamp.",
      );
    const preview = selectEvaluationHoldout(examples, args.cutoffCreatedAt);
    if (preview.previewHash !== args.expectedPreviewHash)
      return yield* invalid(
        "expectedPreviewHash",
        "Evaluation set changed after the freeze preview.",
      );
    if (preview.maturity !== "ready")
      return yield* invalid(
        "cutoffCreatedAt",
        "Freeze requires at least 25 adjudicated examples and five source-separated test examples at or after the cutoff.",
      );
    const selected = new Set(preview.selectedExampleKeys);
    const selectedRows = examples.filter((example) =>
      selected.has(example.exampleKey),
    );
    if (selectedRows.length !== HOLDOUT_EXAMPLE_COUNT)
      return yield* invalid(
        "expectedPreviewHash",
        "Freeze preview no longer resolves to five unique examples.",
      );
    const frozenAt = yield* withClock(Clock.currentTimeMillis);
    const writer = yield* DatabaseWriter;
    for (const example of selectedRows)
      yield* writer
        .table("brainEvaluationExamples")
        .patch(example._id, {
          split: "holdout",
          freezeKey,
          freezePreviewHash: preview.previewHash,
          freezeCutoffCreatedAt: args.cutoffCreatedAt,
          frozenAt,
          frozenByUserId: access.userId,
          updatedAt: Math.max(frozenAt, example.updatedAt + 1),
        })
        .pipe(Effect.orDie);
    return {
      freezeKey,
      frozenAt,
      previewHash: preview.previewHash,
      selectedExampleKeys: preview.selectedExampleKeys,
    };
  });

const exportExamples = (
  args: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly split?: "development" | "holdout" | undefined;
  },
  actorUserId?: GenericId<"users">,
) =>
  Effect.gen(function* () {
    yield* requireAccess(args.workspaceId, "viewer", actorUserId);
    const examples = (yield* readWorkspaceExamples(args.workspaceId)).filter(
      (example) => args.split === undefined || example.split === args.split,
    );
    return buildRedactedEvaluationExport(
      examples.map((example) => ({
        exampleKey: example.exampleKey,
        question: example.question,
        purpose: example.purpose,
        evidenceMode: example.evidenceMode,
        surface: example.surface,
        answerStatus: example.answerStatus,
        packHash: example.packHash,
        ...(example.maxCitations === undefined
          ? {}
          : { maxCitations: example.maxCitations }),
        ...(example.capturedAsOf === undefined
          ? {}
          : { capturedAsOf: example.capturedAsOf }),
        ...(example.policyVersion === undefined
          ? {}
          : { policyVersion: example.policyVersion }),
        evidenceReferences: [...example.evidenceReferences],
        captureKind: example.captureKind,
        usefulness: example.usefulness,
        ...(example.issueReason === undefined
          ? {}
          : { issueReason: example.issueReason }),
        adjudicationState: example.adjudicationState ?? "pending",
        ...(example.expectedAnswerStatus === undefined
          ? {}
          : { expectedAnswerStatus: example.expectedAnswerStatus }),
        expectedEvidenceReferences: [
          ...(example.expectedEvidenceReferences ?? []),
        ],
        ...(example.riskLevel === undefined
          ? {}
          : { riskLevel: example.riskLevel }),
        split: example.split,
        ...(example.freezeKey === undefined
          ? {}
          : { freezeKey: example.freezeKey }),
        createdAt: example.createdAt,
        updatedAt: example.updatedAt,
      })),
    );
  });

const list = FunctionImpl.make(
  databaseSchema,
  group,
  "listBrainEvaluationExamples",
  (args) => listExamples(args),
);
const listForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "listBrainEvaluationExamplesForActor",
  ({ userId, ...args }) => listExamples(args, userId),
);
const get = FunctionImpl.make(
  databaseSchema,
  group,
  "getBrainEvaluationExample",
  (args) => getExample(args),
);
const getForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "getBrainEvaluationExampleForActor",
  ({ userId, ...args }) => getExample(args, userId),
);
const adjudicate = FunctionImpl.make(
  databaseSchema,
  group,
  "adjudicateBrainEvaluationExample",
  (args) => adjudicateExample(args),
);
const adjudicateForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "adjudicateBrainEvaluationExampleForActor",
  ({ userId, ...args }) => adjudicateExample(args, userId),
);
const previewFreeze = FunctionImpl.make(
  databaseSchema,
  group,
  "previewBrainEvaluationFreeze",
  (args) => freezePreview(args),
);
const previewFreezeForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "previewBrainEvaluationFreezeForActor",
  ({ userId, ...args }) => freezePreview(args, userId),
);
const freeze = FunctionImpl.make(
  databaseSchema,
  group,
  "applyBrainEvaluationFreeze",
  (args) => applyFreeze(args),
);
const freezeForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "applyBrainEvaluationFreezeForActor",
  ({ userId, ...args }) => applyFreeze(args, userId),
);
const exportEvaluation = FunctionImpl.make(
  databaseSchema,
  group,
  "exportBrainEvaluationExamples",
  (args) => exportExamples(args),
);
const exportEvaluationForActor = FunctionImpl.make(
  databaseSchema,
  group,
  "exportBrainEvaluationExamplesForActor",
  ({ userId, ...args }) => exportExamples(args, userId),
);

export default GroupImpl.make(databaseSchema, group).pipe(
  Layer.provide(list),
  Layer.provide(listForActor),
  Layer.provide(get),
  Layer.provide(getForActor),
  Layer.provide(adjudicate),
  Layer.provide(adjudicateForActor),
  Layer.provide(previewFreeze),
  Layer.provide(previewFreezeForActor),
  Layer.provide(freeze),
  Layer.provide(freezeForActor),
  Layer.provide(exportEvaluation),
  Layer.provide(exportEvaluationForActor),
  GroupImpl.finalize,
);
