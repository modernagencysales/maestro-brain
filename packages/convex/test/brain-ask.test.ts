import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import pilot, { AskReturns, manifest } from "../confect/brain/pilot.spec";
import {
  buildAskResponse,
  type AskCitation,
  type AskPage,
  type AskRevision,
} from "../confect/brain/retrieval";

const page = (overrides: Partial<AskPage> = {}): AskPage => ({
  pageKey: "pag_brief",
  title: "Launch brief",
  markdown: "The launch is planned for May.",
  status: "active",
  lifecycle: { state: "active", generation: 2 },
  currentRevisionKey: "rev_current",
  ...overrides,
});

const revision = (overrides: Partial<AskRevision> = {}): AskRevision => ({
  pageKey: "pag_brief",
  revisionKey: "rev_current",
  markdown: "The launch is planned for May.",
  state: "published",
  lifecycle: { state: "active", generation: 2 },
  ...overrides,
});

const citation = (overrides: Partial<AskCitation> = {}): AskCitation => ({
  citationId: "citation:brief",
  pageKey: "pag_brief",
  revisionKey: "rev_current",
  sourceTitle: "Launch brief",
  quotedText: "The launch is planned for May.",
  startOffset: 0,
  endOffset: "The launch is planned for May.".length,
  ...overrides,
});

describe("Brain Ask retrieval", () => {
  it("returns only bounded claims with complete current-revision citations", () => {
    expect(
      buildAskResponse({
        query: "when is launch",
        pages: [page()],
        revisions: [revision()],
        citations: [citation()],
      }),
    ).toEqual({
      status: "answered",
      answer: "The launch is planned for May. [citation:brief]",
      evidence: [
        {
          citationKey: "citation:brief",
          pageKey: "pag_brief",
          revisionKey: "rev_current",
          title: "Launch brief",
          excerpt: "The launch is planned for May.",
        },
      ],
    });
  });

  it("abstains when a citation is stale or the page lifecycle is revoked", () => {
    expect(
      buildAskResponse({
        query: "when is launch",
        pages: [page()],
        revisions: [revision({ revisionKey: "rev_old" })],
        citations: [citation({ revisionKey: "rev_old" })],
      }).status,
    ).toBe("abstained");

    expect(
      buildAskResponse({
        query: "when is launch",
        pages: [page({ lifecycle: { state: "archived", generation: 3 } })],
        revisions: [revision()],
        citations: [citation()],
      }),
    ).toMatchObject({ status: "abstained", evidence: [] });
  });

  it("abstains instead of making an unsupported claim", () => {
    expect(
      buildAskResponse({
        query: "who is the CFO",
        pages: [page()],
        revisions: [revision()],
        citations: [citation()],
      }),
    ).toEqual({
      status: "abstained",
      reason: "insufficient_evidence",
      answer: null,
      evidence: [],
    });
  });

  it("publishes an authorized cited Ask contract", () => {
    expect(manifest.map((entry) => entry.operationId)).toContain(
      "brain.pilot.ask",
    );
    expect(JSON.stringify(pilot)).toContain('"name":"ask"');
    expect(
      Schema.decodeUnknownSync(AskReturns)({
        brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
        response: {
          status: "abstained",
          reason: "insufficient_evidence",
          answer: null,
          evidence: [],
        },
      }).response.status,
    ).toBe("abstained");
  });
});
