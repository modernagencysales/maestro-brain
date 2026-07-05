import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  TemplateMainContent,
  TemplateRouteFocusBoundary,
  TemplateToastProvider,
  useTemplateToast,
} from "./ux-essentials";

function ToastTrigger() {
  const toast = useTemplateToast();

  return (
    <button
      type="button"
      onClick={() =>
        toast.notify({
          title: "Saved",
          description: "Workspace settings were updated.",
          tone: "success",
          autoDismissMs: 0,
        })
      }
    >
      Save
    </button>
  );
}

function ToastOutsideProvider() {
  const toast = useTemplateToast();
  const toastId = toast.notify({
    title: "Saved",
    autoDismissMs: 0,
  });

  return <span>{toastId}</span>;
}

describe("TemplateToastProvider", () => {
  it("renders an initial toast with title, detail, and tone", () => {
    const html = renderToStaticMarkup(
      <TemplateToastProvider
        initialToasts={[
          {
            id: "toast_saved",
            title: "Saved",
            description: "Workspace settings were updated.",
            tone: "success",
          },
        ]}
      >
        <ToastTrigger />
      </TemplateToastProvider>,
    );

    expect(html).toContain("template-toast-region");
    expect(html).toContain("template-toast success");
    expect(html).toContain("Saved");
    expect(html).toContain("Workspace settings were updated.");
    expect(html).toContain('aria-live="polite"');
  });

  it("exports a hook for mutation handlers to emit toasts", () => {
    const html = renderToStaticMarkup(
      <TemplateToastProvider>
        <ToastTrigger />
      </TemplateToastProvider>,
    );

    expect(html).toContain("Save");
    expect(useTemplateToast).toBeTypeOf("function");
  });

  it("returns a safe fallback API when the hook is used outside a provider", () => {
    const html = renderToStaticMarkup(<ToastOutsideProvider />);

    expect(html).toContain("template-toast-missing-provider");
  });
});

describe("template route UX helpers", () => {
  it("renders skip-link, polite announcement, and online children", () => {
    const html = renderToStaticMarkup(
      <TemplateRouteFocusBoundary announcement="Viewing Overview" focusKey="/">
        <TemplateMainContent>
          <h1>Overview</h1>
        </TemplateMainContent>
      </TemplateRouteFocusBoundary>,
    );

    expect(html).toContain('href="#template-main-content"');
    expect(html).toContain("Viewing Overview");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="template-main-content"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Overview");
    expect(html).not.toContain("template-network-banner");
  });

  it("can announce degraded network state without changing the main target", () => {
    const html = renderToStaticMarkup(
      <TemplateRouteFocusBoundary
        announcement="Viewing Legal"
        focusKey="/_workspace/legal"
        networkState="degraded"
      >
        <TemplateMainContent className="template-page">
          Legal
        </TemplateMainContent>
      </TemplateRouteFocusBoundary>,
    );

    expect(html).toContain("Network is degraded");
    expect(html).toContain('class="template-page"');
    expect(html).toContain('id="template-main-content"');
  });
});
