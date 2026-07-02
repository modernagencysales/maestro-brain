import { describe, expect, it } from "vitest";
import { createSampleWorkflowRunReceipt } from "@maestro-template/template-core";
import { buildReceiptDocumentSections } from "./receipt-surface";

describe("receipt surface", () => {
  it("turns a workflow receipt into provenance-first document sections", () => {
    const sections = buildReceiptDocumentSections(
      createSampleWorkflowRunReceipt(),
    );

    expect(sections.map((section) => section.heading)).toEqual([
      "Receipt identity",
      "Source provenance",
      "Policy and model",
      "Audit trail",
    ]);
    expect(sections[0]?.body).toContain(
      "trust_run_template_001 proves source-backed-no-default-rag.",
    );
    expect(sections[1]?.body.join("\n")).toContain("Founder interview notes");
    expect(sections[2]?.body).toContain(
      "Model posture: fake/local deterministic model.",
    );
  });
});
