import type { ConditionAst, WorkflowConditionContext } from "./conditionTypes";

type AstByType<Type extends ConditionAst["type"]> = Extract<
  ConditionAst,
  { readonly type: Type }
>;

type BinaryAst = AstByType<"binary">;

type BinaryEvaluator = (
  ast: BinaryAst,
  conditionContext: WorkflowConditionContext,
) => unknown;

export const evaluateConditionAst = (
  ast: ConditionAst,
  conditionContext: WorkflowConditionContext,
): unknown => astEvaluators[ast.type](ast as never, conditionContext);

const astEvaluators: {
  readonly [Type in ConditionAst["type"]]: (
    ast: AstByType<Type>,
    conditionContext: WorkflowConditionContext,
  ) => unknown;
} = {
  identifier: (ast, conditionContext) =>
    readConditionPath(conditionContext, ast.path),
  literal: (ast) => ast.value,
  not: (ast, conditionContext) =>
    !evaluateConditionAst(ast.expression, conditionContext),
  binary: (ast, conditionContext) =>
    binaryEvaluators[ast.operator](ast, conditionContext),
};

const binaryEvaluators: Record<BinaryAst["operator"], BinaryEvaluator> = {
  "&&": (ast, conditionContext) =>
    Boolean(evaluateConditionAst(ast.left, conditionContext)) &&
    Boolean(evaluateConditionAst(ast.right, conditionContext)),
  "||": (ast, conditionContext) =>
    Boolean(evaluateConditionAst(ast.left, conditionContext)) ||
    Boolean(evaluateConditionAst(ast.right, conditionContext)),
  "===": (ast, conditionContext) =>
    evaluateConditionAst(ast.left, conditionContext) ===
    evaluateConditionAst(ast.right, conditionContext),
  "!==": (ast, conditionContext) =>
    evaluateConditionAst(ast.left, conditionContext) !==
    evaluateConditionAst(ast.right, conditionContext),
};

const readConditionPath = (
  conditionContext: WorkflowConditionContext,
  path: readonly string[],
): unknown => {
  let value = readConditionRoot(conditionContext, path[0]);

  for (const segment of path.slice(1)) {
    if (!isReadableObject(value)) {
      return undefined;
    }
    value = value[segment];
  }

  return value;
};

const readConditionRoot = (
  conditionContext: WorkflowConditionContext,
  root: string | undefined,
): unknown => {
  const roots: Readonly<Record<string, unknown>> = {
    inputs: conditionContext.inputs,
    context: conditionContext.context,
    policySnapshot: conditionContext.policySnapshot,
  };
  return root ? roots[root] : undefined;
};

const isReadableObject = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object";
