import * as S from "effect/Schema";

export class DuplicateNodeId extends S.TaggedError<DuplicateNodeId>()(
  "DuplicateNodeId",
  {
    nodeId: S.String,
  },
) {}
