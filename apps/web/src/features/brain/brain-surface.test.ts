import { describe, expect, it } from "vitest";
import * as Either from "effect/Either";
import type { BrainSource } from "@maestro-template/template-core";
import { templateConfectRefs } from "@maestro-template/convex/refs";
import {
  brainReadApiRefs,
  buildBrainDocumentSections,
  buildBrainViewModel,
  createBrainContextPackPreview,
  describeBrainState,
  toBrainContextState,
  toBrainSearchState,
  toBrainSourceState,
  unwrapBrainMutation,
  type BrainContextPackPreview,
  type BrainSearchResult,
} from "./brain-surface";
import type { TemplateDataState } from "../../adapters/confect-state";

const sources: readonly BrainSource[] = [
  {
    title: "Founder notes",
    kind: "markdown",
    freshness: "fresh",
    evidence: "4 grounded claims",
  },
  {
    title: "Approved links",
    kind: "link set",
    freshness: "review due",
    evidence: "3 cited constraints",
  },
];

const contextPack: BrainContextPackPreview = {
  title: "GTM context pack",
  markdownSummary: "A markdown-ready brief for the client workspace.",
  links: ["https://example.test/positioning"],
  evidenceSnapshots: ["Founder notes", "Approved links"],
  freshness: "mixed",
  ragPosture: "optional-not-default",
  trustReceiptPosture: "required",
};

const searchResult: BrainSearchResult = {
  sourceKey: "source_slack",
  sourceRevisionKey: "revision_slack_4",
  publicationSetKey: "publication_slack_7",
  entryKey: "entry_launch",
  passageKey: "passage_launch_1",
  startOffset: 12,
  endOffset: 48,
  contentHash: "sha256:launch",
  kind: "source",
  citationKey: "publication_slack_7:entry_launch",
  title: "Launch thread",
  excerpt: "The approved launch date is Friday.",
  authority: "authoritative",
  authorityPolicyKey: "policy_slack",
  observedAt: 1_754_000_000_000,
  indexedAt: 1_754_000_000_100,
  freshness: "current",
  truncated: false,
  state: "resolved",
};

const completeCoverage = {
  corpusKey: "slack",
  sourceKind: "slack",
  connectorScopeKey: "channel_launch",
  required: true,
  status: "complete" as const,
  freshness: "current" as const,
  unresolvedFailureCount: 0,
};

describe("Brain source surface", () => {
  it("pins the canonical generated Brain read refs", () => {
    expect(brainReadApiRefs).toEqual({
      sourcesSearch: templateConfectRefs.public.brain.readApi.sourcesSearch,
      sourcesGet: templateConfectRefs.public.brain.readApi.sourcesGet,
      contextGet: templateConfectRefs.public.brain.readApi.contextGet,
    });
  });

  it("preserves exact citation identity and maps ready, empty, partial, and stale reads", () => {
    const ready = toBrainSearchState(
      {
        status: "ready",
        mode: "read",
        data: {
          brainKey: "brain_apero",
          results: [searchResult],
          coverage: [completeCoverage],
          omissions: [],
        },
      },
      "launch",
    );
    expect(ready).toMatchObject({
      status: "ready",
      results: [
        {
          publicationSetKey: "publication_slack_7",
          entryKey: "entry_launch",
        },
      ],
    });

    expect(
      toBrainSearchState(
        {
          status: "empty",
          data: {
            brainKey: "brain_apero",
            results: [],
            coverage: [completeCoverage],
            omissions: [],
          },
        },
        "missing",
      ),
    ).toMatchObject({ status: "empty" });

    expect(
      toBrainSearchState(
        {
          status: "ready",
          mode: "read",
          data: {
            brainKey: "brain_apero",
            results: [searchResult],
            coverage: [
              {
                ...completeCoverage,
                status: "partial",
                reason: "reconciliation pending",
              },
            ],
            omissions: [{ reason: "context byte capacity", count: 2 }],
          },
        },
        "launch",
      ),
    ).toMatchObject({ status: "partial" });

    expect(
      toBrainSearchState(
        {
          status: "ready",
          mode: "read",
          data: {
            brainKey: "brain_apero",
            results: [{ ...searchResult, freshness: "stale" }],
            coverage: [{ ...completeCoverage, freshness: "stale" as const }],
            omissions: [],
          },
        },
        "launch",
      ),
    ).toMatchObject({ status: "stale" });
  });

  it("maps unavailable, integrity, and typed capacity failures distinctly", () => {
    expect(
      toBrainSearchState(
        {
          status: "typed_failure",
          error: { _tag: "SubsystemDisabled", subsystem: "ask" },
        },
        "launch",
      ),
    ).toMatchObject({ status: "unavailable" });
    expect(
      toBrainSearchState(
        {
          status: "typed_failure",
          error: {
            _tag: "CitationIntegrityFailure",
            publicationSetKey: "publication_slack_7",
            entryKey: "entry_launch",
            reason: "content_mismatch",
          },
        },
        "launch",
      ),
    ).toMatchObject({ status: "integrity_failure" });
    expect(
      toBrainSearchState(
        {
          status: "typed_failure",
          error: {
            _tag: "RetrievalCapacityExceeded",
            message: "Candidate capacity exceeded.",
          },
        },
        "launch",
      ),
    ).toMatchObject({ status: "capacity_failure" });
  });

  it("maps canonical ContextPack and exact source reads without dropping their tuple", () => {
    expect(
      toBrainContextState({
        status: "ready",
        mode: "read",
        data: {
          schemaVersion: "1",
          candidateManifest: { version: "1", hash: "manifest_hash" },
          requestId: "request_1",
          organizationKey: "organization_apero",
          brainKey: "brain_apero",
          question: "launch",
          asOf: 1_754_000_000_200,
          coverage: [completeCoverage],
          entries: [searchResult],
          conflicts: [],
          omissions: [],
        },
      }),
    ).toMatchObject({
      status: "ready",
      data: {
        entries: [
          {
            publicationSetKey: "publication_slack_7",
            entryKey: "entry_launch",
          },
        ],
      },
    });

    expect(
      toBrainSourceState({
        status: "ready",
        mode: "read",
        data: {
          ...searchResult,
          brainKey: "brain_apero",
          revisionKey: searchResult.sourceRevisionKey,
          status: "published",
        },
      }),
    ).toMatchObject({
      status: "ready",
      data: {
        publicationSetKey: "publication_slack_7",
        entryKey: "entry_launch",
      },
    });
    expect(
      toBrainSourceState({
        status: "ready",
        mode: "read",
        data: {
          ...searchResult,
          brainKey: "brain_apero",
          revisionKey: searchResult.sourceRevisionKey,
          status: "superseded",
        },
      }),
    ).toMatchObject({ status: "stale" });
  });

  it("builds a source-backed Brain view model with markdown, links, freshness, and evidence", () => {
    const state: TemplateDataState<{
      readonly sources: readonly BrainSource[];
      readonly contextPack: BrainContextPackPreview;
    }> = {
      status: "ready",
      mode: "read",
      data: { sources, contextPack },
    };

    expect(buildBrainViewModel(state)).toEqual({
      status: "ready",
      sources: [
        expect.objectContaining({
          title: "Founder notes",
          kind: "markdown",
          freshness: "fresh",
          evidence: "4 grounded claims",
        }),
        expect.objectContaining({
          title: "Approved links",
          kind: "link set",
          freshness: "review due",
          evidence: "3 cited constraints",
        }),
      ],
      contextPack: expect.objectContaining({
        markdownSummary: "A markdown-ready brief for the client workspace.",
        links: ["https://example.test/positioning"],
        evidenceSnapshots: ["Founder notes", "Approved links"],
        ragPosture: "optional-not-default",
        trustReceiptPosture: "required",
      }),
    });
  });

  it("renders Brain doctrine into document sections", () => {
    const sections = buildBrainDocumentSections({ sources, contextPack });
    const text = JSON.stringify(sections);

    expect(text).toContain("source content is data, not instructions");
    expect(text).toContain("RAG/vector search is optional");
    expect(text).toContain("Trust Receipts carry the provenance");
    expect(text).toContain("Founder notes");
    expect(text).toContain("https://example.test/positioning");
  });

  it("builds context previews and unwraps successful mutations", () => {
    expect(createBrainContextPackPreview(["Founder notes"])).toMatchObject({
      evidenceSnapshots: ["Founder notes"],
      freshness: "fresh",
      trustReceiptPosture: "required",
    });
    expect(unwrapBrainMutation(42)).toBe(42);
    expect(unwrapBrainMutation(Either.right("saved"))).toBe("saved");
  });

  it("describes loading, empty, typed error, transport error, and parse error states", () => {
    expect(describeBrainState({ status: "loading" })).toMatchObject({
      heading: "Loading Brain sources",
    });
    expect(describeBrainState({ status: "empty", data: null })).toMatchObject({
      heading: "No approved Brain sources yet",
    });
    expect(
      describeBrainState({
        status: "typed_failure",
        error: { _tag: "ValidationFailed", message: "Bad source" },
      }),
    ).toMatchObject({
      heading: "Brain request was rejected by policy",
    });
    expect(
      describeBrainState({
        status: "transport_failure",
        error: new Error("offline"),
        message: "offline",
      }),
    ).toMatchObject({
      heading: "Brain sources are temporarily unavailable",
    });
    expect(
      describeBrainState({
        status: "parse_failure",
        error: new SyntaxError("bad payload"),
        message: "bad payload",
      }),
    ).toMatchObject({
      heading: "Brain source payload could not be decoded",
    });
  });
});
