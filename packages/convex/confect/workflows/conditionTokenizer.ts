import {
  conditionExpressionError,
  type ConditionToken,
} from "./conditionTypes";

type TokenRead =
  { readonly token?: ConditionToken; readonly nextIndex: number } | undefined;

type TokenReader = (
  expression: string,
  index: number,
  char: string,
) => TokenRead;

export const tokenizeConditionExpression = (
  expression: string,
): readonly ConditionToken[] => {
  const tokens: ConditionToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const result = readNextToken(expression, index);
    if (result.token) {
      tokens.push(result.token);
    }
    index = result.nextIndex;
  }

  tokens.push({ type: "eof" });
  return tokens;
};

const readNextToken = (
  expression: string,
  index: number,
): { readonly token?: ConditionToken; readonly nextIndex: number } => {
  const char = expression[index];
  if (!char) {
    return { nextIndex: expression.length };
  }

  for (const reader of tokenReaders) {
    const result = reader(expression, index, char);
    if (result) {
      return result;
    }
  }

  throw conditionExpressionError(`unsupported condition token: ${char}`);
};

const tokenReaders: readonly TokenReader[] = [
  readWhitespace,
  readComparisonOperator,
  readLogicalOperator,
  readInvalidEquality,
  readNotOperator,
  readParen,
  readString,
  readNumber,
  readIdentifier,
];

function readWhitespace(
  _expression: string,
  index: number,
  char: string,
): TokenRead {
  return /\s/.test(char) ? { nextIndex: index + 1 } : undefined;
}

function readComparisonOperator(expression: string, index: number): TokenRead {
  const value = expression.slice(index, index + 3);
  return value === "===" || value === "!=="
    ? { token: { type: "operator", value }, nextIndex: index + 3 }
    : undefined;
}

function readLogicalOperator(expression: string, index: number): TokenRead {
  const value = expression.slice(index, index + 2);
  return value === "&&" || value === "||"
    ? { token: { type: "operator", value }, nextIndex: index + 2 }
    : undefined;
}

function readInvalidEquality(
  _expression: string,
  _index: number,
  char: string,
): TokenRead {
  if (char !== "=") {
    return undefined;
  }
  throw conditionExpressionError(
    "assignments and loose equality are not allowed",
  );
}

function readNotOperator(
  expression: string,
  index: number,
  char: string,
): TokenRead {
  if (char !== "!") {
    return undefined;
  }
  if (expression[index + 1] === "=") {
    throw conditionExpressionError("loose inequality is not allowed");
  }
  return { token: { type: "operator", value: "!" }, nextIndex: index + 1 };
}

function readParen(
  _expression: string,
  index: number,
  char: string,
): TokenRead {
  return char === "(" || char === ")"
    ? { token: { type: "paren", value: char }, nextIndex: index + 1 }
    : undefined;
}

function readString(
  expression: string,
  index: number,
  char: string,
): TokenRead {
  if (char !== "'" && char !== '"') {
    return undefined;
  }
  const result = readStringLiteral(expression, index, char);
  return {
    token: { type: "string", value: result.value },
    nextIndex: result.nextIndex,
  };
}

function readNumber(
  expression: string,
  index: number,
  char: string,
): TokenRead {
  if (!/[0-9]/.test(char)) {
    return undefined;
  }
  const match = /^[0-9]+(?:\.[0-9]+)?/.exec(expression.slice(index));
  if (!match) {
    throw conditionExpressionError("invalid number literal");
  }
  return {
    token: { type: "number", value: Number(match[0]) },
    nextIndex: index + match[0].length,
  };
}

function readIdentifier(
  expression: string,
  index: number,
  char: string,
): TokenRead {
  if (!/[A-Za-z_]/.test(char)) {
    return undefined;
  }
  const match = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(
    expression.slice(index),
  );
  if (!match) {
    throw conditionExpressionError("invalid identifier");
  }
  return {
    token: { type: "identifier", value: match[0] },
    nextIndex: index + match[0].length,
  };
}

const readStringLiteral = (
  expression: string,
  startIndex: number,
  quote: "'" | '"',
): { readonly value: string; readonly nextIndex: number } => {
  let value = "";
  let index = startIndex + 1;

  while (index < expression.length) {
    const char = expression[index];
    if (char === quote) {
      return { value, nextIndex: index + 1 };
    }
    const read = readStringCharacter(expression, index, char);
    value += read.value;
    index = read.nextIndex;
  }

  throw conditionExpressionError("unterminated string literal");
};

const readStringCharacter = (
  expression: string,
  index: number,
  char: string | undefined,
): { readonly value: string; readonly nextIndex: number } => {
  if (char !== "\\") {
    return { value: char ?? "", nextIndex: index + 1 };
  }
  return readEscapedCharacter(expression, index);
};

const readEscapedCharacter = (
  expression: string,
  index: number,
): { readonly value: string; readonly nextIndex: number } => {
  const escaped = expression[index + 1];
  if (!escaped || !["\\", "'", '"', "n", "r", "t"].includes(escaped)) {
    throw conditionExpressionError("unsupported string escape");
  }
  return {
    value: decodeEscapedCharacter(escaped),
    nextIndex: index + 2,
  };
};

const decodeEscapedCharacter = (escaped: string): string => {
  const escapedCharacters: Readonly<Record<string, string>> = {
    n: "\n",
    r: "\r",
    t: "\t",
  };
  return escapedCharacters[escaped] ?? escaped;
};
