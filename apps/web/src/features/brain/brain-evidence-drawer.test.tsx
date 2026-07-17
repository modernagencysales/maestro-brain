import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { BrainEvidenceDrawer } from "./brain-evidence-drawer";

describe("BrainEvidenceDrawer", () => {
  it("renders desktop evidence/history region and mobile drawer affordance", () => {
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <BrainEvidenceDrawer
          citations={["Slack #sales", "Approved discovery note"]}
          freshness="current"
          revisionLabel="rev_overview"
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("Evidence and history");
    expect(html).toContain("Mobile evidence drawer");
    expect(html).toContain("Slack #sales");
    expect(html).toContain("Approved discovery note");
    expect(html).toContain("rev_overview");
  });
});
