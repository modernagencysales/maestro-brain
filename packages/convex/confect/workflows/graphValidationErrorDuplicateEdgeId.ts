import * as S from "effect/Schema";

export class DuplicateEdgeId extends S.TaggedError<DuplicateEdgeId>()(
  "DuplicateEdgeId",
  {
    edgeId: S.String,
  },
) {}
