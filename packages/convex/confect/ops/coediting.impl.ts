import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import coediting from "./coediting.spec";

const now = 1_700_000_000_000;

const listDocuments = FunctionImpl.make(
  databaseSchema,
  coediting,
  "listDocuments",
  (input) =>
    Effect.succeed([
      {
        documentId: `document_${input.workspaceId}_example`,
        workspaceId: input.workspaceId,
        slug: "example-source-note",
        title: "Example source note",
        latestVersionId: "version_001",
        sourceKind: "markdown" as const,
        sourceIds: ["source_001"],
        createdAt: now,
        updatedAt: now,
      },
    ]),
);

const createDocument = FunctionImpl.make(
  databaseSchema,
  coediting,
  "createDocument",
  (input) =>
    Effect.succeed({
      documentId: `document_${input.idempotencyKey}`,
      workspaceId: input.workspaceId,
      slug: input.slug,
      title: input.title,
      latestVersionId: `version_${input.idempotencyKey}`,
      sourceKind: input.sourceKind,
      sourceIds: input.sourceIds,
      createdAt: now,
      updatedAt: now,
    }),
);

const appendVersion = FunctionImpl.make(
  databaseSchema,
  coediting,
  "appendVersion",
  (input) =>
    Effect.succeed({
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      versionId: input.versionId,
      priorVersionId: input.priorVersionId,
      markdown: input.markdown,
      author: input.author,
      createdAt: now,
    }),
);

const createAnnotation = FunctionImpl.make(
  databaseSchema,
  coediting,
  "createAnnotation",
  (input) =>
    Effect.succeed({
      annotationId: `annotation_${input.idempotencyKey}`,
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      versionId: input.versionId,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      quotedText: input.quotedText,
      author: input.author,
      body: input.body,
      status: "open" as const,
      createdAt: now,
    }),
);

export default GroupImpl.make(databaseSchema, coediting).pipe(
  Layer.provide(listDocuments),
  Layer.provide(createDocument),
  Layer.provide(appendVersion),
  Layer.provide(createAnnotation),
  GroupImpl.finalize,
);
