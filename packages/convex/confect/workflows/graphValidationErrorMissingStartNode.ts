import * as S from "effect/Schema";

export class MissingStartNode extends S.TaggedError<MissingStartNode>()(
  "MissingStartNode",
  {
    startNodeId: S.String,
  },
) {}
