import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  SourceSegmentRow,
  SourceUnitRevisionRow,
  SourceUnitRow,
  buildCallSourceUnitRows,
} from "../confect/sources/sourceUnit";
import { CitationRow } from "../confect/tables/citations";
import sourceSegmentsSource from "../confect/tables/sourceSegments";
import sourceUnitRevisionsSource from "../confect/tables/sourceUnitRevisions";
import sourceUnitsSource from "../confect/tables/sourceUnits";

const authority = {
  organizationKey: "agency_acme",
  connectionGeneration: 2,
  receivedAt: 1_000,
} as const;

const call = {
  providerKey: "fireflies",
  connectionKey: "conn_fireflies_1",
  externalCallId: "call_1",
  externalRevisionId: "revision_1",
  revisionOrder: {
    kind: "provider_timestamp",
    timestamp: "2026-08-05T14:00:00.000Z",
    source: "updated_at",
  },
  title: "Acme weekly",
  startedAt: "2026-08-05T14:00:00.000Z",
  endedAt: "2026-08-05T14:30:00.000Z",
  durationMs: 1_800_000,
  organizer: null,
  participants: [],
  segments: [
    {
      externalSegmentId: "call_1:0",
      ordinal: 0,
      evidenceKind: "verbatim_transcript",
      speakerExternalId: "speaker_1",
      speakerLabel: "Alex",
      startMs: 0,
      endMs: 2_000,
      text: "We will launch on Friday.",
    },
  ],
  sourceUrl: "https://app.fireflies.ai/view/call_1",
  recordingUrl: null,
  providerSummary: null,
  providerMetadataJson: "{}",
  deleted: false,
} as const;

describe("canonical source units", () => {
  it("builds stable source-unit and exact segment rows", () => {
    const first = buildCallSourceUnitRows(call, authority);
    const second = buildCallSourceUnitRows(call, authority);

    expect(second).toEqual(first);
    expect(first.segments[0]).toMatchObject({
      ordinal: 0,
      speakerLabel: "Alex",
      text: "We will launch on Friday.",
    });
    expect(Schema.decodeUnknownSync(SourceUnitRow)(first.unit)).toEqual(
      first.unit,
    );
    expect(
      Schema.decodeUnknownSync(SourceUnitRevisionRow)(first.revision),
    ).toEqual(first.revision);
    expect(
      Schema.decodeUnknownSync(SourceSegmentRow)(first.segments[0]),
    ).toEqual(first.segments[0]);
  });

  it("changes only the revision identity when transcript content changes", () => {
    const first = buildCallSourceUnitRows(call, authority);
    const changed = buildCallSourceUnitRows(
      {
        ...call,
        externalRevisionId: "revision_2",
        segments: [{ ...call.segments[0], text: "We launched Friday." }],
      },
      authority,
    );

    expect(changed.unit.unitKey).toBe(first.unit.unitKey);
    expect(changed.revision.unitRevisionKey).not.toBe(
      first.revision.unitRevisionKey,
    );
    expect(changed.segments[0]?.segmentKey).not.toBe(
      first.segments[0]?.segmentKey,
    );
  });

  it("sorts segments and rejects ambiguous or unsafe transcript shapes", () => {
    const second = {
      ...call.segments[0],
      externalSegmentId: "call_1:1",
      ordinal: 1,
      text: "Second",
    };
    expect(
      buildCallSourceUnitRows(
        { ...call, segments: [second, call.segments[0]] },
        authority,
      ).segments.map((segment) => segment.ordinal),
    ).toEqual([0, 1]);
    expect(() =>
      buildCallSourceUnitRows(
        { ...call, segments: [call.segments[0], call.segments[0]] },
        authority,
      ),
    ).toThrow("duplicate transcript segment");
    expect(() =>
      buildCallSourceUnitRows({ ...call, segments: [] }, authority),
    ).toThrow("empty transcript");
    expect(() =>
      buildCallSourceUnitRows(
        {
          ...call,
          segments: [{ ...call.segments[0], text: "x".repeat(32_001) }],
        },
        authority,
      ),
    ).toThrow("segment exceeds 32000 characters");
  });

  it("allows empty tombstones", () => {
    const rows = buildCallSourceUnitRows(
      {
        ...call,
        externalRevisionId: "revision_deleted",
        segments: [],
        deleted: true,
      },
      authority,
    );

    expect(rows.revision.tombstone).toBe(true);
    expect(rows.segments).toEqual([]);
    expect(rows.unit.lifecycle.state).toBe("deleted_tombstone");
  });

  it("keeps timestamp validation on persisted revision rows", () => {
    const revision = buildCallSourceUnitRows(call, authority).revision;

    expect(() =>
      Schema.decodeUnknownSync(SourceUnitRevisionRow)({
        ...revision,
        startedAt: "not-an-iso-timestamp",
      }),
    ).toThrow();
  });

  it("declares the provider-neutral source indexes", () => {
    expect(sourceUnitsSource("sourceUnits").indexes).toEqual({
      by_org_connection_external: [
        "organizationKey",
        "connectionKey",
        "connectionGeneration",
        "providerKey",
        "externalCallId",
      ],
      by_org_connection_generation_unit_key: [
        "organizationKey",
        "connectionKey",
        "connectionGeneration",
        "unitKey",
      ],
      by_unit_key: ["organizationKey", "unitKey"],
      by_org_current_state: ["organizationKey", "lifecycle.state"],
      by_organization_updated: ["organizationKey", "updatedAt"],
    });
    expect(sourceUnitRevisionsSource("sourceUnitRevisions").indexes).toEqual({
      by_organization_ledger: ["organizationKey"],
      by_unit_revision_key: ["organizationKey", "unitRevisionKey"],
      by_unit_created: ["organizationKey", "unitKey", "createdAt"],
    });
    expect(sourceSegmentsSource("sourceSegments").indexes).toEqual({
      by_unit_revision_ordinal: [
        "organizationKey",
        "unitRevisionKey",
        "ordinal",
      ],
      by_segment_key: ["organizationKey", "segmentKey"],
    });
  });

  it("expands citations without invalidating existing note rows", () => {
    const base = {
      workspaceId: "brain_acme",
      citationId: "citation_1",
      claimId: "claim_1",
      sourceId: "source_1",
      sourceTitle: "Acme weekly",
      quotedText: "We will launch on Friday.",
      startOffset: 0,
      endOffset: 25,
      createdAt: 1_000,
    };

    expect(
      Schema.decodeUnknownSync(CitationRow)({
        ...base,
        sourceKind: "note",
      }),
    ).toMatchObject({ sourceKind: "note" });
    expect(
      Schema.decodeUnknownSync(CitationRow)({
        ...base,
        sourceKind: "call_transcript",
        sourceUnitRevisionKey: "surev_1",
        segmentKey: "seg_1",
        startMs: 0,
        endMs: 2_000,
      }),
    ).toMatchObject({
      sourceKind: "call_transcript",
      segmentKey: "seg_1",
      startMs: 0,
      endMs: 2_000,
    });
  });
});
