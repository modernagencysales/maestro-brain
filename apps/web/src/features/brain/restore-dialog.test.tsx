import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RestoreDialog } from "./restore-dialog";

describe("RestoreDialog", () => {
  it("disables restore for viewers", () => {
    const html = renderToStaticMarkup(
      <RestoreDialog
        open
        canRestore={false}
        revisionKey="rev_old"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain("Restore revision");
    expect(html).toContain("disabled");
  });

  it("explains that restore appends history", () => {
    const html = renderToStaticMarkup(
      <RestoreDialog
        open
        canRestore
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        revisionKey="rev_old"
      />,
    );
    expect(html).toContain("Existing history will remain unchanged");
  });
});
