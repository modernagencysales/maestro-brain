import {
  conditionExpressionError,
  type ConditionAst,
  type ConditionToken,
} from "./conditionTypes";

export class ConditionParser {
  private index = 0;

  constructor(private readonly tokens: readonly ConditionToken[]) {}

  parseExpression(): ConditionAst {
    return this.parseOr();
  }

  expectEof(): void {
    if (this.peek().type !== "eof") {
      throw conditionExpressionError("unexpected trailing condition token");
    }
  }

  private parseOr(): ConditionAst {
    let ast = this.parseAnd();
    while (this.matchOperator("||")) {
      ast = this.binary("||", ast, this.parseAnd());
    }
    return ast;
  }

  private parseAnd(): ConditionAst {
    let ast = this.parseEquality();
    while (this.matchOperator("&&")) {
      ast = this.binary("&&", ast, this.parseEquality());
    }
    return ast;
  }

  private parseEquality(): ConditionAst {
    const left = this.parseUnary();
    const token = this.peek();
    if (!isEqualityOperator(token)) {
      return left;
    }

    this.index += 1;
    return this.binary(token.value, left, this.parseUnary());
  }

  private parseUnary(): ConditionAst {
    return this.matchOperator("!")
      ? { type: "not", expression: this.parseUnary() }
      : this.parsePrimary();
  }

  private parsePrimary(): ConditionAst {
    return (
      this.parseIdentifierPrimary() ??
      this.parseLiteralPrimary() ??
      this.parseParenthesizedPrimary() ??
      failExpectedPrimary()
    );
  }

  private parseIdentifierPrimary(): ConditionAst | undefined {
    const token = this.peek();
    if (token.type !== "identifier") {
      return undefined;
    }

    this.index += 1;
    return identifierAst(token.value);
  }

  private parseLiteralPrimary(): ConditionAst | undefined {
    const token = this.peek();
    if (token.type !== "string" && token.type !== "number") {
      return undefined;
    }

    this.index += 1;
    return { type: "literal", value: token.value };
  }

  private parseParenthesizedPrimary(): ConditionAst | undefined {
    if (!this.matchParen("(")) {
      return undefined;
    }

    const ast = this.parseExpression();
    if (!this.matchParen(")")) {
      throw conditionExpressionError("missing closing parenthesis");
    }
    return ast;
  }

  private matchOperator(operator: "===" | "!==" | "&&" | "||" | "!"): boolean {
    const token = this.peek();
    if (token.type !== "operator" || token.value !== operator) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private matchParen(paren: "(" | ")"): boolean {
    const token = this.peek();
    if (token.type !== "paren" || token.value !== paren) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private binary(
    operator: "===" | "!==" | "&&" | "||",
    left: ConditionAst,
    right: ConditionAst,
  ): ConditionAst {
    return { type: "binary", operator, left, right };
  }

  private peek(): ConditionToken {
    return this.tokens[this.index] ?? { type: "eof" };
  }
}

type EqualityOperatorToken = {
  readonly type: "operator";
  readonly value: "===" | "!==";
};

const isEqualityOperator = (
  token: ConditionToken,
): token is EqualityOperatorToken =>
  token.type === "operator" && (token.value === "===" || token.value === "!==");

const identifierAst = (value: string): ConditionAst => {
  const path = value.split(".");
  const root = path[0];
  if (!isAllowedRoot(root)) {
    throw conditionExpressionError(
      `unsupported condition identifier: ${root ?? ""}`,
    );
  }
  if (hasBlockedPathSegment(path)) {
    throw conditionExpressionError(
      "constructor and prototype access are not allowed",
    );
  }
  return { type: "identifier", path };
};

const isAllowedRoot = (root: string | undefined): boolean =>
  root === "inputs" || root === "context" || root === "policySnapshot";

const hasBlockedPathSegment = (path: readonly string[]): boolean =>
  path.includes("constructor") || path.includes("__proto__");

const failExpectedPrimary = (): never => {
  throw conditionExpressionError("expected condition primary expression");
};
