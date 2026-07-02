import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import knowledge from "./knowledge.spec";

const now = 1_700_000_000_000;

const upsertConcept = FunctionImpl.make(
  databaseSchema,
  knowledge,
  "upsertConcept",
  (input) =>
    Effect.succeed({
      conceptId: input.conceptId,
      workspaceId: input.workspaceId,
      label: input.label,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    }),
);

const upsertClaim = FunctionImpl.make(
  databaseSchema,
  knowledge,
  "upsertClaim",
  (input) =>
    Effect.succeed({
      claimId: input.claimId,
      workspaceId: input.workspaceId,
      conceptIds: input.conceptIds,
      body: input.body,
      status: input.status,
      citationIds: input.citationIds,
      createdAt: now,
    }),
);

const attachCitation = FunctionImpl.make(
  databaseSchema,
  knowledge,
  "attachCitation",
  (input) =>
    Effect.succeed({
      citationId: input.citationId,
      workspaceId: input.workspaceId,
      claimId: input.claimId,
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      sourceTitle: input.sourceTitle,
      quotedText: input.quotedText,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      createdAt: now,
    }),
);

const buildContextPack = FunctionImpl.make(
  databaseSchema,
  knowledge,
  "buildContextPack",
  (input) =>
    Effect.succeed({
      contextPackId: input.contextPackId,
      workspaceId: input.workspaceId,
      title: input.title,
      sourceIds: input.sourceIds,
      citationIds: input.citationIds,
      claimIds: input.claimIds,
      freshness: input.freshness,
      trustReceiptId: input.trustReceiptId,
      sourceBacked: true,
      createdAt: now,
    }),
);

const getContextPack = FunctionImpl.make(
  databaseSchema,
  knowledge,
  "getContextPack",
  (input) =>
    Effect.succeed({
      contextPackId: input.contextPackId,
      workspaceId: input.workspaceId,
      title: "Example source-backed context pack",
      sourceIds: ["source_founder_notes"],
      citationIds: ["citation_001"],
      claimIds: ["claim_001"],
      freshness: "fresh" as const,
      trustReceiptId: "trust_receipt_001",
      sourceBacked: true,
      createdAt: now,
    }),
);

export default GroupImpl.make(databaseSchema, knowledge).pipe(
  Layer.provide(upsertConcept),
  Layer.provide(upsertClaim),
  Layer.provide(attachCitation),
  Layer.provide(buildContextPack),
  Layer.provide(getContextPack),
  GroupImpl.finalize,
);
