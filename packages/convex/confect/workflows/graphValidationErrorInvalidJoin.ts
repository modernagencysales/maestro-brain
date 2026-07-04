import * as S from "effect/Schema";

export class InvalidJoin extends S.TaggedError<InvalidJoin>()("InvalidJoin", {
  nodeId: S.String,
  reason: S.String,
}) {}
