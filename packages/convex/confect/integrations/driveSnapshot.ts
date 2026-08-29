import type { GoogleDriveSourceObservation } from "@maestro-template/integrations/nango/googleDrive";
import type { GenericId } from "convex/values";
import { evidencePassages } from "../brain/evidenceProjection";
import { sha256Hex } from "../shared/sha256";

export const DRIVE_SEGMENT_MAX_CHARACTERS = 24_000;
export const DRIVE_NORMALIZATION_VERSION = 1;
export const DRIVE_RUN_MAX_EVIDENCE_ITEMS = 1_000;

type DriveCapacityState = "oversized_paragraph" | "projection_capacity";

type DriveEvidenceItem = {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: "google_drive";
  readonly scopeKey: string;
  readonly runKey: string;
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly title: string;
  readonly markdown: string;
  readonly locator: string;
  readonly providerMetadataJson: string;
  readonly providerMetadataHash: string;
  readonly sourceModifiedAt: number;
  readonly observedAt: number;
};

export type DriveEvidenceBuildResult = {
  readonly items: readonly DriveEvidenceItem[];
  readonly capacityStates: readonly {
    readonly fileId: string;
    readonly fileName: string;
    readonly state: DriveCapacityState;
  }[];
  readonly metadataOnlyCount: number;
};

type TextBlock = {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly heading: string | null;
};

const normalizedBlocks = (content: string): readonly TextBlock[] => {
  const blocks: TextBlock[] = [];
  const separator = /\n[ \t]*\n+/gu;
  let cursor = 0;
  const append = (untrimmedStart: number, untrimmedEnd: number) => {
    let startOffset = untrimmedStart;
    let endOffset = untrimmedEnd;
    while (startOffset < endOffset && /\s/u.test(content[startOffset] ?? ""))
      startOffset += 1;
    while (endOffset > startOffset && /\s/u.test(content[endOffset - 1] ?? ""))
      endOffset -= 1;
    if (startOffset === endOffset) return;
    const text = content.slice(startOffset, endOffset);
    const headingMatch = /^(#{1,6})[ \t]+(.+)$/u.exec(text);
    blocks.push({
      startOffset,
      endOffset,
      heading: headingMatch?.[2]?.trim() ?? null,
    });
  };
  for (const match of content.matchAll(separator)) {
    const matchIndex = match.index;
    if (matchIndex === undefined) continue;
    append(cursor, matchIndex);
    cursor = matchIndex + match[0].length;
  }
  append(cursor, content.length);
  return blocks;
};

const segmentBlocks = (
  content: string,
  blocks: readonly TextBlock[],
):
  | { readonly state: DriveCapacityState; readonly block: TextBlock }
  | { readonly segments: readonly (readonly TextBlock[])[] } => {
  const oversized = blocks.find(
    (block) =>
      block.endOffset - block.startOffset > DRIVE_SEGMENT_MAX_CHARACTERS,
  );
  if (oversized !== undefined)
    return { state: "oversized_paragraph", block: oversized };

  const segments: TextBlock[][] = [];
  let current: TextBlock[] = [];
  for (const block of blocks) {
    const first = current[0];
    const length = block.endOffset - (first?.startOffset ?? block.startOffset);
    if (current.length > 0 && length > DRIVE_SEGMENT_MAX_CHARACTERS) {
      segments.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) segments.push(current);

  const projectionFailure = segments
    .flatMap((segment) => {
      const first = segment[0];
      const last = segment.at(-1);
      if (first === undefined || last === undefined) return [];
      const markdown = content.slice(first.startOffset, last.endOffset);
      return evidencePassages("Drive segment", markdown).capacityExceeded
        ? [first]
        : [];
    })
    .at(0);
  return projectionFailure === undefined
    ? { segments }
    : { state: "projection_capacity", block: projectionFailure };
};

const headingBefore = (
  blocks: readonly TextBlock[],
  startOffset: number,
): { readonly text: string; readonly startOffset: number } | null => {
  const heading = [...blocks]
    .reverse()
    .find(
      (block) => block.startOffset <= startOffset && block.heading !== null,
    );
  return heading?.heading === null || heading?.heading === undefined
    ? null
    : { text: heading.heading, startOffset: heading.startOffset };
};

const itemFor = (input: {
  readonly observation: GoogleDriveSourceObservation;
  readonly workspaceId: GenericId<"workspaces">;
  readonly scopeKey: string;
  readonly runKey: string;
  readonly observedAt: number;
  readonly segmentIndex: number;
  readonly segmentCount: number;
  readonly markdown: string;
  readonly documentBodyHash: string | null;
  readonly renderedStartOffset: number | null;
  readonly renderedEndOffset: number | null;
  readonly headingBoundary: {
    readonly text: string;
    readonly startOffset: number;
  } | null;
  readonly contentStatus: "text" | "metadata_only" | "capacity_exceeded";
  readonly capacityState: DriveCapacityState | null;
}): DriveEvidenceItem => {
  const fileId = input.observation.providerObjectId;
  const sourceKey = `google_drive:file:${fileId}:segment:${input.segmentIndex}`;
  const providerMetadataJson = JSON.stringify({
    schemaVersion: 1,
    normalizationVersion: DRIVE_NORMALIZATION_VERSION,
    fileId,
    fileName: input.observation.metadata.name,
    mimeType: input.observation.metadata.mimeType,
    driveId: input.observation.metadata.driveId,
    parentFolderIds: input.observation.metadata.parentFolderIds,
    providerRevisionKey: input.observation.revisionKey,
    providerVersion: input.observation.metadata.version,
    segmentIndex: input.segmentIndex,
    segmentCount: input.segmentCount,
    documentBodyHash: input.documentBodyHash,
    renderedStartOffset: input.renderedStartOffset,
    renderedEndOffset: input.renderedEndOffset,
    headingBoundary: input.headingBoundary,
    contentStatus: input.contentStatus,
    capacityState: input.capacityState,
  });
  const providerMetadataHash = sha256Hex(providerMetadataJson);
  const baseTitle = `Drive · ${input.observation.metadata.name}`;
  const title =
    input.contentStatus === "metadata_only"
      ? `${baseTitle} · Metadata only`
      : input.contentStatus === "capacity_exceeded"
        ? `${baseTitle} · Content exceeds safe ingestion bounds`
        : input.segmentCount === 1
          ? baseTitle
          : `${baseTitle} · ${input.segmentIndex + 1}/${input.segmentCount}`;
  const revisionKey = `drive-segment-v1:${sha256Hex(
    JSON.stringify({
      providerRevisionKey: input.observation.revisionKey,
      sourceKey,
      title,
      markdownHash: sha256Hex(input.markdown),
      providerMetadataHash,
    }),
  )}`;
  return {
    workspaceId: input.workspaceId,
    provider: "google_drive",
    scopeKey: input.scopeKey,
    runKey: input.runKey,
    sourceKey,
    revisionKey,
    title,
    markdown: input.markdown,
    locator: input.observation.sourceLocator,
    providerMetadataJson,
    providerMetadataHash,
    sourceModifiedAt: input.observation.sourceModifiedAt,
    observedAt: input.observedAt,
  };
};

export const buildDriveEvidenceItems = (
  observations: readonly GoogleDriveSourceObservation[],
  input: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly scopeKey: string;
    readonly runKey: string;
    readonly observedAt: number;
  },
): DriveEvidenceBuildResult => {
  const items: DriveEvidenceItem[] = [];
  const capacityStates: Array<{
    fileId: string;
    fileName: string;
    state: DriveCapacityState;
  }> = [];
  let metadataOnlyCount = 0;

  for (const observation of [...observations].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  )) {
    const content = observation.metadata.contentText;
    if (content === null || content.trim().length === 0) {
      metadataOnlyCount += 1;
      items.push(
        itemFor({
          observation,
          ...input,
          segmentIndex: 0,
          segmentCount: 1,
          markdown: "",
          documentBodyHash: content === null ? null : sha256Hex(content),
          renderedStartOffset: null,
          renderedEndOffset: null,
          headingBoundary: null,
          contentStatus: "metadata_only",
          capacityState: null,
        }),
      );
      continue;
    }

    const blocks = normalizedBlocks(content);
    const segmentation = segmentBlocks(content, blocks);
    const documentBodyHash = sha256Hex(content);
    if ("state" in segmentation) {
      capacityStates.push({
        fileId: observation.providerObjectId,
        fileName: observation.metadata.name,
        state: segmentation.state,
      });
      items.push(
        itemFor({
          observation,
          ...input,
          segmentIndex: 0,
          segmentCount: 1,
          markdown: "",
          documentBodyHash,
          renderedStartOffset: segmentation.block.startOffset,
          renderedEndOffset: segmentation.block.endOffset,
          headingBoundary: headingBefore(
            blocks,
            segmentation.block.startOffset,
          ),
          contentStatus: "capacity_exceeded",
          capacityState: segmentation.state,
        }),
      );
      continue;
    }

    segmentation.segments.forEach((segment, segmentIndex) => {
      const first = segment[0];
      const last = segment.at(-1);
      if (first === undefined || last === undefined) return;
      items.push(
        itemFor({
          observation,
          ...input,
          segmentIndex,
          segmentCount: segmentation.segments.length,
          markdown: content.slice(first.startOffset, last.endOffset),
          documentBodyHash,
          renderedStartOffset: first.startOffset,
          renderedEndOffset: last.endOffset,
          headingBoundary: headingBefore(blocks, first.startOffset),
          contentStatus: "text",
          capacityState: null,
        }),
      );
    });
  }

  if (items.length > DRIVE_RUN_MAX_EVIDENCE_ITEMS) {
    throw new Error(
      `Google Drive evidence item capacity of ${DRIVE_RUN_MAX_EVIDENCE_ITEMS} was exceeded.`,
    );
  }
  return { items, capacityStates, metadataOnlyCount };
};
