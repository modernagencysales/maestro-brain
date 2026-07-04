import * as S from "effect/Schema";

export class InvalidRetryConfig extends S.TaggedError<InvalidRetryConfig>()(
  "InvalidRetryConfig",
  {
    nodeId: S.String,
    field: S.Literal("maxAttempts", "backoffMs"),
  },
) {}
