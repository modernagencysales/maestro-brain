const isWordCharacter = (value: string | undefined) =>
  value !== undefined && /[\p{L}\p{N}_-]/u.test(value);
const offsetSplitsWord = (markdown: string, offset: number) =>
  isWordCharacter(markdown[offset - 1]) && isWordCharacter(markdown[offset]);

const rewindToWordStart = (
  markdown: string,
  offset: number,
  lowerBound: number,
) => {
  let result = offset;
  while (result > lowerBound && offsetSplitsWord(markdown, result)) result -= 1;
  return result;
};

const advanceWhile = (
  markdown: string,
  offset: number,
  upperBound: number,
  predicate: (value: string | undefined) => boolean,
) => {
  let result = offset;
  while (result < upperBound && predicate(markdown[result])) result += 1;
  return result;
};

const cleanExcerptStart = (
  markdown: string,
  desiredStartOffset: number,
  desiredEndOffset: number,
  passageStartOffset: number,
) => {
  const rewoundOffset = rewindToWordStart(
    markdown,
    desiredStartOffset,
    passageStartOffset,
  );
  const wholeWordOffset =
    rewoundOffset === passageStartOffset &&
    passageStartOffset > 0 &&
    offsetSplitsWord(markdown, passageStartOffset)
      ? advanceWhile(markdown, rewoundOffset, desiredEndOffset, isWordCharacter)
      : rewoundOffset;
  return advanceWhile(markdown, wholeWordOffset, desiredEndOffset, (value) =>
    /\s/u.test(value ?? ""),
  );
};

const cleanExcerptEnd = (
  markdown: string,
  startOffset: number,
  boundedEndOffset: number,
) => {
  let endOffset = boundedEndOffset;
  while (endOffset > startOffset && offsetSplitsWord(markdown, endOffset))
    endOffset -= 1;
  if (endOffset === startOffset && boundedEndOffset > startOffset)
    endOffset = boundedEndOffset;
  while (endOffset > startOffset && /\s/u.test(markdown[endOffset - 1] ?? ""))
    endOffset -= 1;
  return endOffset;
};

export const evidenceExcerpt = (
  markdown: string,
  queryTokens: readonly string[],
  passageStartOffset = 0,
  passageEndOffset = markdown.length,
) => {
  const passage = markdown.slice(passageStartOffset, passageEndOffset);
  const normalized = passage.toLowerCase();
  const first = queryTokens.reduce((best, token) => {
    const found = normalized.indexOf(token);
    return found < 0 ? best : Math.min(best, found);
  }, Number.POSITIVE_INFINITY);
  const desiredStartOffset =
    passageStartOffset +
    Math.max(0, (Number.isFinite(first) ? first : 0) - 120);
  const desiredEndOffset = Math.min(passageEndOffset, desiredStartOffset + 640);
  const startOffset = cleanExcerptStart(
    markdown,
    desiredStartOffset,
    desiredEndOffset,
    passageStartOffset,
  );
  const boundedEndOffset = Math.min(passageEndOffset, startOffset + 640);
  const endOffset = cleanExcerptEnd(markdown, startOffset, boundedEndOffset);
  return {
    excerpt: markdown.slice(startOffset, endOffset),
    startOffset,
    endOffset,
  };
};
