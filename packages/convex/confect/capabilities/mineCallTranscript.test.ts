import { createStructuredLlmGateway } from "@maestro-template/integrations";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatherMaintenanceContext } from "./gatherMaintenanceContext.spec";
import { decodeMinedCall } from "./mineCallTranscript.domain";
import { mineCallTranscriptWithGateway } from "./mineCallTranscript.impl";
import { createOpenRouterStructuredTransport } from "./mineCallTranscript.node";

const context = {
  brainKey: "br_acme",
  citations: [
    {
      citationKey: "cite_segment_1",
      quote: "Alex owns launch by Friday.",
    },
  ],
} as const;

describe("call transcript mining output", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts cited structured facts for the routed Brain", () => {
    expect(
      decodeMinedCall(
        {
          summary: "Acme approved Friday launch.",
          summaryCitationKeys: ["cite_segment_1"],
          decisions: [
            { text: "Launch Friday", citationKeys: ["cite_segment_1"] },
          ],
          commitments: [
            {
              text: "Launch by Friday",
              owner: "Alex",
              dueDate: "Friday",
              citationKeys: ["cite_segment_1"],
            },
          ],
          risks: [],
          stakeholderChanges: [],
          pageProposals: [
            {
              brainKey: "br_acme",
              pageKey: "pag_br_acme_brief",
              title: "Client Brief",
              markdown: "# Client Brief\nLaunch Friday.",
              citationKeys: ["cite_segment_1"],
            },
          ],
        },
        context,
      ),
    ).toMatchObject({ summary: "Acme approved Friday launch." });
  });

  it("rejects unknown citations and another Brain", () => {
    expect(() =>
      decodeMinedCall(
        {
          summary: "Invented",
          summaryCitationKeys: ["cite_unknown"],
          decisions: [],
          commitments: [],
          risks: [],
          stakeholderChanges: [],
          pageProposals: [
            {
              brainKey: "br_other",
              pageKey: "pag_other",
              title: "Other",
              markdown: "Invented",
              citationKeys: ["cite_unknown"],
            },
          ],
        },
        context,
      ),
    ).toThrow("unknown citation");
  });

  it("rejects uncited or invented owner and due-date fields", () => {
    expect(() =>
      decodeMinedCall(
        {
          summary: "",
          summaryCitationKeys: [],
          decisions: [],
          commitments: [
            {
              text: "Follow up",
              owner: "Morgan",
              dueDate: "Monday",
              citationKeys: ["cite_segment_1"],
            },
          ],
          risks: [],
          stakeholderChanges: [],
          pageProposals: [],
        },
        context,
      ),
    ).toThrow("owner or due date is not cited");
  });

  it("mines gathered evidence through the structured gateway without retaining raw text", async () => {
    const gathered: GatherMaintenanceContext = {
      workspaceId: "workspace_acme" as GenericId<"workspaces">,
      organizationId: "organization_acme",
      organizationKey: "agency_acme",
      brainKey: "br_acme",
      unitKey: "sunit_acme",
      unitRevisionKey: "surev_acme_1",
      sourceLifecycleGeneration: 2,
      routeGeneration: 4,
      policyGeneration: 7,
      workspaceLifecycleGeneration: 3,
      source: {
        title: "Acme weekly",
        startedAt: "2026-08-05T14:00:00.000Z",
        sourceUrl: "https://example.test/call_1",
      },
      pages: [
        {
          pageKey: "pag_br_acme_overview",
          title: "Overview",
          currentRevisionKey: "rev_br_acme_overview_1",
          lifecycleGeneration: 1,
          markdown: "# Overview\n\nCurrent context.",
        },
      ],
      citations: [
        {
          citationKey: "cite_segment_1",
          sourceUnitKey: "sunit_acme",
          revisionKey: "surev_acme_1",
          segmentKey: "seg_1",
          evidenceKind: "verbatim_transcript" as const,
          speakerLabel: "Alex",
          startMs: 0,
          endMs: 2_000,
          quote: "Alex owns launch by Friday.",
        },
      ],
    };
    const gateway = createStructuredLlmGateway({
      mode: "fake",
      env: {},
      fakeStructuredOutput: {
        summary: "Acme approved Friday launch.",
        summaryCitationKeys: ["cite_segment_1"],
        decisions: [],
        commitments: [
          {
            text: "Launch by Friday",
            owner: "Alex",
            dueDate: "Friday",
            citationKeys: ["cite_segment_1"],
          },
        ],
        risks: [],
        stakeholderChanges: [],
        pageProposals: [
          {
            brainKey: "br_acme",
            pageKey: "pag_br_acme_overview",
            title: "Overview",
            markdown: "# Overview\n\nLaunch Friday.",
            citationKeys: ["cite_segment_1"],
          },
        ],
      },
    });

    const result = await Effect.runPromise(
      mineCallTranscriptWithGateway(gathered, "mine_call_1", gateway),
    );

    expect(result.output.pageProposals).toHaveLength(1);
    expect(result.receipt).toMatchObject({
      attemptKey: "mine_call_1",
      organizationId: "organization_acme",
      workspaceSlug: "workspace_acme",
      requestHash: expect.stringMatching(/^sha256:/),
      responseHash: expect.stringMatching(/^sha256:/),
    });
    expect(JSON.stringify(result.receipt)).not.toContain(
      "Alex owns launch by Friday.",
    );
  });

  it("requests strict structured commitments with optional owner and due date", async () => {
    let requestBody: Record<string, any> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({}) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.01 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const result = await Effect.runPromise(
      createOpenRouterStructuredTransport({
        OPENROUTER_API_KEY: "test-key",
      })({
        provider: "openrouter",
        model: "openrouter/test",
        region: "us",
        requestHash: "sha256:request",
        sourceHash: "sha256:source",
        outputSchemaName: "Struct",
        outputSchemaHash: "sha256:schema",
        serializedProviderRequest: { canonicalJson: "{}" },
      }),
    );

    expect(
      requestBody.response_format.json_schema.schema.properties.commitments
        .items.properties,
    ).toMatchObject({
      text: { type: "string" },
      owner: { type: "string" },
      dueDate: { type: "string" },
    });
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      costCents: 1,
    });
  });
});
