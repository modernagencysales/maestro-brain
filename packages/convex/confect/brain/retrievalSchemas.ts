import * as Schema from "effect/Schema";

export const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);
export const PositiveInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThan(0),
);
export const ContentHash = Schema.String.pipe(
  Schema.pattern(/^sha256:[a-f0-9]{64}$/),
);
export const RetrievalEntryKey = Schema.String.pipe(
  Schema.pattern(/^rent_[a-f0-9]{64}$/),
);
export const RetrievalPassageKey = Schema.String.pipe(
  Schema.pattern(/^rpass_[a-f0-9]{64}$/),
);
export const RetrievalPublicationSetKey = Schema.String.pipe(
  Schema.pattern(/^rset_[a-f0-9]{64}$/),
);
export const RetrievalPublicationSubjectKey = Schema.String.pipe(
  Schema.pattern(/^rsub_[a-f0-9]{64}$/),
);

export const RetrievalOriginReference = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("page"),
    pageKey: Schema.String,
    revisionKey: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("slack"),
    sourceKey: Schema.String,
    sourceRevisionKey: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("transcript"),
    unitKey: Schema.String,
    unitRevisionKey: Schema.String,
    segmentKey: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("document"),
    connectionKey: Schema.String,
    connectorScopeKey: Schema.String,
    objectKey: Schema.String,
    revisionKey: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("projection"),
    projectionKey: Schema.String,
    revisionKey: Schema.String,
  }),
);

export type RetrievalOriginReference = typeof RetrievalOriginReference.Type;
