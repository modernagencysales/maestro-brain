import { evaluateConditionAst } from "./conditionEvaluator";
import { ConditionParser } from "./conditionParser";
import { tokenizeConditionExpression } from "./conditionTokenizer";
import type { ConditionAst, WorkflowConditionContext } from "./conditionTypes";

export type { WorkflowConditionContext } from "./conditionTypes";

export const isSafeConditionExpression = (expression: string): boolean => {
  try {
    parseConditionExpression(expression);
    return true;
  } catch {
    return false;
  }
};

export const evaluateSafeConditionExpression = (
  expression: string,
  conditionContext: WorkflowConditionContext,
): boolean => {
  const ast = parseConditionExpression(expression);
  return Boolean(evaluateConditionAst(ast, conditionContext));
};

const parseConditionExpression = (expression: string): ConditionAst => {
  const parser = new ConditionParser(tokenizeConditionExpression(expression));
  const ast = parser.parseExpression();
  parser.expectEof();
  return ast;
};
