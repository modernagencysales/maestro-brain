import { sha256Hex } from "@maestro-template/template-core/sha256";

const MAX_PASSAGE_BYTES = 8 * 1024;
const MAX_OVERLAP_BYTES = 512;

export type DrivePassage = Readonly<{
  passageKey: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  headingPath: readonly string[];
  text: string;
  contentHash: string;
}>;

type TextBoundary = Readonly<{ charOffset: number; byteOffset: number }>;
type Heading = Readonly<{
  charOffset: number;
  path: readonly string[];
}>;

const utf8Boundaries = (text: string): readonly TextBoundary[] => {
  const encoder = new TextEncoder();
  const boundaries: TextBoundary[] = [{ charOffset: 0, byteOffset: 0 }];
  let charOffset = 0;
  let byteOffset = 0;
  for (const character of text) {
    charOffset += character.length;
    byteOffset += encoder.encode(character).byteLength;
    boundaries.push({ charOffset, byteOffset });
  }
  return boundaries;
};

const byteAt = (
  boundaries: readonly TextBoundary[],
  charOffset: number,
): number =>
  boundaries.find((boundary) => boundary.charOffset === charOffset)
    ?.byteOffset ?? 0;

const headingTimeline = (text: string): readonly Heading[] => {
  const headings: Heading[] = [];
  const path: string[] = [];
  const pattern = /^(#{1,6})[ \t]+(.+?)\s*$/gm;
  for (const match of text.matchAll(pattern)) {
    const level = match[1]?.length ?? 1;
    const label = match[2]?.trim() ?? "";
    if (!label) continue;
    path.splice(level - 1);
    path[level - 1] = label;
    headings.push({ charOffset: match.index, path: [...path] });
  }
  return headings;
};

const headingAt = (
  headings: readonly Heading[],
  charOffset: number,
): readonly string[] => {
  let selected: readonly string[] = [];
  for (const heading of headings) {
    if (heading.charOffset > charOffset) break;
    selected = heading.path;
  }
  return selected;
};

const paragraphStarts = (text: string): readonly number[] => {
  const starts = [0];
  const pattern = /\n\n+/g;
  for (const match of text.matchAll(pattern)) {
    starts.push(match.index + match[0].length);
  }
  return starts;
};

const preferredEnds = (text: string): readonly number[] => {
  const ends = new Set<number>([text.length]);
  for (const match of text.matchAll(/\n\n+|(?<=[.!?])\s+|\s+/g)) {
    ends.add(match.index + match[0].length);
  }
  return [...ends].sort((left, right) => left - right);
};

const maximumCharEnd = (
  boundaries: readonly TextBoundary[],
  startByte: number,
): number => {
  let end = 0;
  for (const boundary of boundaries) {
    if (boundary.byteOffset - startByte > MAX_PASSAGE_BYTES) break;
    end = boundary.charOffset;
  }
  return end;
};

export const buildDrivePassages = (
  input: Readonly<{
    providerRevisionKey: string;
    normalizedText: string;
  }>,
): readonly DrivePassage[] => {
  if (input.normalizedText.length === 0) return [];
  const boundaries = utf8Boundaries(input.normalizedText);
  const headings = headingTimeline(input.normalizedText);
  const starts = paragraphStarts(input.normalizedText);
  const ends = preferredEnds(input.normalizedText);
  const passages: DrivePassage[] = [];
  let startChar = 0;

  while (startChar < input.normalizedText.length) {
    const startByte = byteAt(boundaries, startChar);
    const hardEnd = maximumCharEnd(boundaries, startByte);
    const candidates = ends.filter(
      (candidate) => candidate > startChar && candidate <= hardEnd,
    );
    const endChar = candidates.at(-1) ?? hardEnd;
    if (endChar <= startChar) {
      throw new Error("Drive passage construction made no UTF-8 progress");
    }
    const endByte = byteAt(boundaries, endChar);
    const text = input.normalizedText.slice(startChar, endChar);
    const contentHash = sha256Hex(text);
    const headingPath = headingAt(headings, startChar);
    const ordinal = passages.length;
    const passageKey = `gdp_${sha256Hex(
      JSON.stringify({
        providerRevisionKey: input.providerRevisionKey,
        headingPath,
        ordinal,
        startOffset: startByte,
        endOffset: endByte,
        contentHash,
      }),
    )}`;
    passages.push({
      passageKey,
      ordinal,
      startOffset: startByte,
      endOffset: endByte,
      headingPath,
      text,
      contentHash,
    });
    if (endChar === input.normalizedText.length) break;

    const minimumNextByte = endByte - MAX_OVERLAP_BYTES;
    const overlapStart = starts.find((candidate) => {
      const candidateByte = byteAt(boundaries, candidate);
      return (
        candidate > startChar &&
        candidate < endChar &&
        candidateByte >= minimumNextByte
      );
    });
    startChar = overlapStart ?? endChar;
  }
  return passages;
};

export const drivePassageLimits = {
  maxPassageBytes: MAX_PASSAGE_BYTES,
  maxOverlapBytes: MAX_OVERLAP_BYTES,
} as const;
