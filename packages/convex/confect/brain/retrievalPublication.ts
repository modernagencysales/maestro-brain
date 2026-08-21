import { sha256Hex } from "../shared/sha256";

export const RETRIEVAL_PASSAGE_MAX_BYTES = 8 * 1024;
export const RETRIEVAL_PASSAGE_OVERLAP_BYTES = 512;
export const RETRIEVAL_QUERY_TOKEN_LIMIT = 12;
export const RETRIEVAL_POSTING_LIMIT = 5_000;
export const RETRIEVAL_CANDIDATE_LIMIT = 40;
export const RETRIEVAL_CONTEXT_ENTRY_LIMIT = 8;
export const RETRIEVAL_CONTEXT_MAX_BYTES = 64 * 1024;
export const RETRIEVAL_ENTRY_MAX_BYTES = 12 * 1024;

export type RetrievalAuthority = "authoritative" | "derived" | "advisory";
export type RetrievalKind =
  "page" | "slack" | "transcript" | "document" | "projection";

export type RetrievalOrigin = {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly corpusKey: string;
  readonly originTable: string;
  readonly kind: RetrievalKind;
  readonly origin: import("./retrievalSchemas").RetrievalOriginReference;
  readonly connectionKey?: string;
  readonly connectionGeneration?: number;
  readonly connectorScopeKey?: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly title: string;
  readonly locator?: string;
  readonly sourceModifiedAt?: number;
  readonly observedAt: number;
  readonly indexedAt: number;
  readonly authority: RetrievalAuthority;
  readonly authorityPolicyKey: string;
  readonly policyGeneration: number;
  readonly lifecycleGeneration: number;
  readonly routeGeneration: number;
};

export const retrievalPublicationSubjectKey = (
  origin: Pick<
    RetrievalOrigin,
    | "workspaceId"
    | "brainKey"
    | "corpusKey"
    | "originTable"
    | "kind"
    | "sourceKey"
    | "connectorScopeKey"
  >,
) =>
  `rsub_${hash({
    workspaceId: origin.workspaceId,
    brainKey: origin.brainKey,
    corpusKey: origin.corpusKey,
    originTable: origin.originTable,
    kind: origin.kind,
    sourceKey: origin.sourceKey,
    connectorScopeKey: origin.connectorScopeKey ?? null,
  })}`;

export type RetrievalPassage = {
  readonly passageKey: string;
  readonly ordinal: number;
  readonly headingPath: string | null;
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly contentHash: string;
};

const utf8 = new TextEncoder();
const byteLength = (value: string) => utf8.encode(value).byteLength;
const hash = (value: unknown) => sha256Hex(JSON.stringify(value));

const normalizedLines = (input: string) =>
  input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();

const headingFor = (line: string) => {
  const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
  return match ? { depth: match[1]?.length ?? 1, title: match[2] ?? "" } : null;
};

type TextBoundary = {
  readonly charOffset: number;
  readonly byteOffset: number;
};

const textBoundaries = (value: string): readonly TextBoundary[] => {
  const boundaries: TextBoundary[] = [{ charOffset: 0, byteOffset: 0 }];
  let charOffset = 0;
  let byteOffset = 0;
  for (const character of value) {
    charOffset += character.length;
    byteOffset += byteLength(character);
    boundaries.push({ charOffset, byteOffset });
  }
  return boundaries;
};

const boundaryAtOrBeforeByte = (
  boundaries: readonly TextBoundary[],
  maximumByteOffset: number,
) => {
  let low = 0;
  let high = boundaries.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((boundaries[middle]?.byteOffset ?? 0) <= maximumByteOffset)
      low = middle;
    else high = middle - 1;
  }
  return boundaries[low] ?? { charOffset: 0, byteOffset: 0 };
};

const charToByteOffset = (
  boundaries: readonly TextBoundary[],
  charOffset: number,
) => {
  const boundary = boundaries.find(
    (candidate) => candidate.charOffset === charOffset,
  );
  if (boundary === undefined)
    throw new Error("offset is not a Unicode code-point boundary");
  return boundary.byteOffset;
};

const regexBoundaryOffsets = (input: string, expression: RegExp) => {
  const offsets: number[] = [];
  for (const match of input.matchAll(expression)) {
    if (match.index === undefined) continue;
    offsets.push(match.index + (match[0]?.length ?? 0));
  }
  return offsets;
};

const lastOffsetInside = (
  offsets: readonly number[],
  startExclusive: number,
  endInclusive: number,
) => {
  for (let index = offsets.length - 1; index >= 0; index -= 1) {
    const offset = offsets[index] ?? 0;
    if (offset <= startExclusive) return undefined;
    if (offset <= endInclusive) return offset;
  }
  return undefined;
};

const headingPathAt = (
  headings: readonly {
    readonly charOffset: number;
    readonly depth: number;
    readonly title: string;
  }[],
  charOffset: number,
) => {
  const stack: string[] = [];
  for (const heading of headings) {
    if (heading.charOffset > charOffset) break;
    stack.splice(heading.depth - 1);
    stack[heading.depth - 1] = heading.title;
  }
  return stack.length > 0 ? stack.join(" > ") : null;
};

export const buildRetrievalPassages = (
  input: string,
  originRevisionKey: string,
  options: {
    readonly maxBytes?: number;
    readonly overlapBytes?: number;
  } = {},
): readonly RetrievalPassage[] => {
  const normalized = normalizedLines(input);
  if (!normalized) return [];
  const maxBytes = options.maxBytes ?? RETRIEVAL_PASSAGE_MAX_BYTES;
  const overlapBytes = options.overlapBytes ?? RETRIEVAL_PASSAGE_OVERLAP_BYTES;
  if (maxBytes <= 0 || overlapBytes < 0 || overlapBytes >= maxBytes)
    throw new Error("invalid retrieval passage bounds");

  const boundaries = textBoundaries(normalized);
  const totalBytes = boundaries.at(-1)?.byteOffset ?? 0;
  const headingMatches = [...normalized.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  const headings = headingMatches.map((match) => {
    const heading = headingFor(match[0] ?? "");
    return {
      charOffset: match.index ?? 0,
      depth: heading?.depth ?? 1,
      title: heading?.title ?? "",
    };
  });
  const headingBreaks = headings.map(({ charOffset }) => charOffset);
  const paragraphBreaks = regexBoundaryOffsets(normalized, /\n{2,}/g);
  const sentenceBreaks = regexBoundaryOffsets(normalized, /[.!?](?:\s+|$)/g);
  const draft: Array<{
    text: string;
    headingPath: string | null;
    startOffset: number;
    endOffset: number;
  }> = [];
  let startChar = 0;
  let startByte = 0;
  while (startByte < totalBytes) {
    const maximum = boundaryAtOrBeforeByte(
      boundaries,
      Math.min(totalBytes, startByte + maxBytes),
    );
    const endChar =
      maximum.byteOffset === totalBytes
        ? maximum.charOffset
        : (lastOffsetInside(headingBreaks, startChar, maximum.charOffset) ??
          lastOffsetInside(paragraphBreaks, startChar, maximum.charOffset) ??
          lastOffsetInside(sentenceBreaks, startChar, maximum.charOffset) ??
          maximum.charOffset);
    if (endChar <= startChar)
      throw new Error("unable to advance retrieval passage boundary");
    const endByte = charToByteOffset(boundaries, endChar);
    const text = normalized.slice(startChar, endChar);
    if (byteLength(text) > maxBytes)
      throw new Error("retrieval passage exceeds byte capacity");
    draft.push({
      text,
      headingPath: headingPathAt(headings, startChar),
      startOffset: startByte,
      endOffset: endByte,
    });
    if (endByte >= totalBytes) break;

    const overlapFloor = Math.max(0, endByte - overlapBytes);
    const overlapStart = paragraphBreaks.find((offset) => {
      const byteOffset = charToByteOffset(boundaries, offset);
      return (
        offset > startChar && byteOffset >= overlapFloor && byteOffset < endByte
      );
    });
    startChar = overlapStart ?? endChar;
    startByte = charToByteOffset(boundaries, startChar);
  }

  return draft.map((passage, ordinal) => {
    const contentHash = `sha256:${hash(passage.text)}`;
    return {
      ...passage,
      ordinal,
      contentHash,
      passageKey: `rpass_${hash({
        originRevisionKey,
        ordinal,
        headingPath: passage.headingPath,
        startOffset: passage.startOffset,
        endOffset: passage.endOffset,
        contentHash,
      })}`,
    };
  });
};

export const retrievalEntryKey = (
  origin: RetrievalOrigin,
  passage: RetrievalPassage,
) =>
  `rent_${hash({
    publicationSubjectKey: retrievalPublicationSubjectKey(origin),
    sourceRevisionKey: origin.sourceRevisionKey,
    passageKey: passage.passageKey,
  })}`;

export const retrievalPublicationSetKey = (
  origin: RetrievalOrigin,
  publicationGeneration: number,
) =>
  `rset_${hash({
    publicationSubjectKey: retrievalPublicationSubjectKey(origin),
    workspaceId: origin.workspaceId,
    brainKey: origin.brainKey,
    corpusKey: origin.corpusKey,
    origin: origin.origin,
    sourceRevisionKey: origin.sourceRevisionKey,
    routeGeneration: origin.routeGeneration,
    lifecycleGeneration: origin.lifecycleGeneration,
    policyGeneration: origin.policyGeneration,
    publicationGeneration,
  })}`;

const stopWords = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "does",
  "is",
  "when",
  "where",
  "what",
  "who",
  "the",
  "this",
  "that",
  "was",
  "were",
  "with",
]);

export const retrievalTokens = (input: string) =>
  input
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2 && !stopWords.has(token));

export const uniqueQueryTokens = (input: string) =>
  [...new Set(retrievalTokens(input))].slice(0, RETRIEVAL_QUERY_TOKEN_LIMIT);

export const buildRetrievalTokenRows = (input: {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly entryKey: string;
  readonly title: string;
  readonly headingPath: string | null;
  readonly text: string;
  readonly authority?: RetrievalAuthority;
}) => {
  const title = new Set(retrievalTokens(input.title));
  const heading = new Set(retrievalTokens(input.headingPath ?? ""));
  const counts = new Map<string, number>();
  for (const token of retrievalTokens(input.text))
    counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const token of title) counts.set(token, counts.get(token) ?? 0);
  for (const token of heading) counts.set(token, counts.get(token) ?? 0);
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([token, termFrequency]) => ({
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      tokenizerVersion: 1 as const,
      token,
      entryKey: input.entryKey,
      authorityRank: (input.authority === "authoritative"
        ? 1
        : input.authority === "advisory"
          ? 3
          : 2) as 1 | 2 | 3,
      termFrequency,
      inTitle: title.has(token),
      inHeading: heading.has(token),
    }));
};

export const retrievalScore = (input: {
  readonly queryTokens: readonly string[];
  readonly postings: readonly {
    readonly token: string;
    readonly termFrequency: number;
    readonly inTitle: boolean;
    readonly inHeading: boolean;
  }[];
  readonly authority: RetrievalAuthority;
  readonly freshness: "current" | "stale" | "unknown";
}) => {
  const matched = new Set(input.postings.map(({ token }) => token));
  const coverage = input.queryTokens.length
    ? matched.size / input.queryTokens.length
    : 0;
  const termScore = input.postings.reduce(
    (total, posting) =>
      total +
      Math.min(posting.termFrequency, 5) +
      (posting.inTitle ? 8 : 0) +
      (posting.inHeading ? 4 : 0),
    0,
  );
  const authorityScore =
    input.authority === "authoritative"
      ? 3
      : input.authority === "derived"
        ? 2
        : 1;
  const freshnessScore =
    input.freshness === "current" ? 3 : input.freshness === "stale" ? -3 : 0;
  return (
    authorityScore * 1_000_000 +
    coverage * 10_000 +
    termScore * 10 +
    freshnessScore
  );
};
