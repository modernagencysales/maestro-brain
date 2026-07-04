import * as S from "effect/Schema";

export class InvalidConditionExpression extends S.TaggedError<InvalidConditionExpression>()(
  "InvalidConditionExpression",
  {
    edgeId: S.String,
  },
) {}
