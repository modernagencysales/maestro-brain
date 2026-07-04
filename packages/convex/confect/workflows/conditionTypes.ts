import { ConvexError } from "convex/values";

export type ConditionToken =
  | { readonly type: "identifier"; readonly value: string }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | {
      readonly type: "operator";
      readonly value: "===" | "!==" | "&&" | "||" | "!";
    }
  | { readonly type: "paren"; readonly value: "(" | ")" }
  | { readonly type: "eof" };

export type ConditionAst =
  | { readonly type: "identifier"; readonly path: readonly string[] }
  | { readonly type: "literal"; readonly value: string | number }
  | {
      readonly type: "binary";
      readonly operator: "===" | "!==" | "&&" | "||";
      readonly left: ConditionAst;
      readonly right: ConditionAst;
    }
  | { readonly type: "not"; readonly expression: ConditionAst };

export type WorkflowConditionContext = {
  readonly inputs: unknown;
  readonly context: Readonly<Record<string, unknown>>;
  readonly policySnapshot: unknown;
};

export const conditionExpressionError = (message: string) =>
  new ConvexError({
    code: "INVALID_WORKFLOW_CONDITION_EXPRESSION",
    message,
  });
