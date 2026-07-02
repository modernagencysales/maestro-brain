import { describe, expect, it } from "vitest";
import promptRegistry from "../confect/tables/promptRegistry";
import {
  definePrompt,
  modelRequestFromPrompt,
  promptRef,
  PromptVersionImmutableError,
  xmlUserPrompt,
} from "../confect/policy/prompts";

describe("prompt registry", () => {
  it("brands prompt refs and rejects raw prompt strings", () => {
    const ref = promptRef("gtm.planner", 1);

    expect(ref).toBe("prompt:gtm.planner:v1");
    expect(() => promptRef("raw model id", 1)).toThrow();
  });

  it("defines immutable prompt versions with status", () => {
    const prompt = definePrompt({
      family: "gtm.planner",
      version: 1,
      status: "active",
      modelRef: "openrouter:anthropic/claude-sonnet",
      body: "Use approved sources only.",
      createdAt: 1_000,
    });

    expect(prompt).toMatchObject({
      ref: "prompt:gtm.planner:v1",
      family: "gtm.planner",
      version: 1,
      status: "active",
    });
    expect(() =>
      definePrompt({
        ...prompt,
        body: "Changed body",
      }),
    ).toThrow(PromptVersionImmutableError);
  });

  it("escapes XML user prompt content and separates source text from instructions", () => {
    expect(
      xmlUserPrompt({
        instruction: "Summarize <carefully> & cite.",
        sourceText: "Customer says: <script>alert('x')</script> & more",
      }),
    ).toBe(
      "<user_prompt><instruction>Summarize &lt;carefully&gt; &amp; cite.</instruction><source_content>Customer says: &lt;script&gt;alert(&apos;x&apos;)&lt;/script&gt; &amp; more</source_content></user_prompt>",
    );
  });

  it("requires PromptRef rather than raw model id for model requests", () => {
    expect(
      modelRequestFromPrompt({
        prompt: definePrompt({
          family: "gtm.planner",
          version: 2,
          status: "active",
          modelRef: "openrouter:anthropic/claude-sonnet",
          body: "Use approved sources only.",
          createdAt: 2_000,
        }),
        userPromptXml: "<user_prompt />",
      }),
    ).toEqual({
      promptRef: "prompt:gtm.planner:v2",
      modelRef: "openrouter:anthropic/claude-sonnet",
      userPromptXml: "<user_prompt />",
    });
  });

  it("declares prompt registry Confect table indexes", () => {
    expect(promptRegistry.indexes).toMatchObject({
      by_ref: ["ref"],
      by_family_version: ["family", "version"],
      by_family_status: ["family", "status"],
    });
  });
});
