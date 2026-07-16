import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { CreateClientDialog } from "./create-client-dialog";

describe("CreateClientDialog", () => {
  it.each([
    [
      { status: "creating", idempotencyKey: "idem" } as const,
      "Creating client Brain",
    ],
    [
      { status: "seeding", idempotencyKey: "idem" } as const,
      "Seeding six-page Client Brief",
    ],
    [
      {
        status: "ready",
        idempotencyKey: "idem",
        brainKey: "br_client",
        initialPageKey: "pag_br_client_overview",
        capacity: {
          clientBrains: 3,
          clientBrainLimit: 25,
          remainingClientBrains: 22,
        },
      } as const,
      "Capacity",
    ],
    [
      {
        status: "failed",
        idempotencyKey: "idem",
        message: "Try again",
      } as const,
      "Try again",
    ],
  ])("renders onboarding %s", (onboarding, text) => {
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <CreateClientDialog
          onboarding={onboarding}
          onSubmit={() => undefined}
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain(text);
    if (text === "Capacity") expect(html).toContain("3/");
  });
});
