import * as S from "effect/Schema";

export class DanglingEdge extends S.TaggedError<DanglingEdge>()(
  "DanglingEdge",
  {
    edgeId: S.String,
    nodeId: S.String,
  },
) {}
