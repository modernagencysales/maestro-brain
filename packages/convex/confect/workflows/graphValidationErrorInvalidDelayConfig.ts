import * as S from "effect/Schema";

export class InvalidDelayConfig extends S.TaggedError<InvalidDelayConfig>()(
  "InvalidDelayConfig",
  {
    nodeId: S.String,
    field: S.Literal("delayMs"),
  },
) {}
