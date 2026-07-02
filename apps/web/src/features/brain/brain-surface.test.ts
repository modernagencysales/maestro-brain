import { describe, expect, it } from "vitest";
import type { BrainSource } from "@maestro-template/template-core";
import {
  buildBrainDocumentSections,
  buildBrainViewModel,
  describeBrainState,
  type BrainContextPackPreview,
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

describe("Brain source surface", () => {
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
