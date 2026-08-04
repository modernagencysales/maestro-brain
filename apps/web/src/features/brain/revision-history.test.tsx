import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  RevisionHistory,
  type BrainRevisionHistoryState,
} from "./revision-history";

const render = (history: BrainRevisionHistoryState) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <RevisionHistory history={history} />
    </MaestroSaasUiProvider>,
  );

describe("RevisionHistory", () => {
  it("renders history loading state", () => {
    expect(render({ status: "loading" })).toContain("Loading revision history");
  });

  it("renders revision keys and timestamps when ready", () => {
    const html = render({
      status: "ready",
      data: {
        brainKey: "br_01J0000000000000000000000A",
        pageKey: "pag_01J0000000000000000000000A",
        asOf: 1_754_000_000_000,
        freshness: { status: "current" },
        revisions: [
          {
            revisionKey: "rev_01J0000000000000000000000A",
            priorRevisionKey: null,
            causation: "create",
            createdAt: 1_754_000_000_000,
            lifecycleGeneration: 1,
          },
        ],
      },
    });

    expect(html).toContain("rev_01J0000000000000000000000A");
    expect(html).toContain(new Date(1_754_000_000_000).toLocaleString());
  });

  it("shows an explicit disabled restore state without a backend contract", () => {
    const html = render({
      status: "ready",
      data: {
        brainKey: "br_01J0000000000000000000000A",
        pageKey: "pag_01J0000000000000000000000A",
        asOf: 1,
        freshness: { status: "current" },
        revisions: [],
      },
    });

    expect(html).toContain("Restore unavailable");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Restore revision");
  });
});
