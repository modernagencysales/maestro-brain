/**
 * summarize — a registered prompt that asks a model to condense a document into
 * three bullet points. The system and user strings instruct a downstream
 * runtime model; they are product data, not application control flow.
 */
export const summarizePrompt = {
  name: "summarize",
  version: 1,
  system:
    "You are a precise summarizer. Read the document and respond ONLY with three " +
    "bullet points capturing its key claims. No preamble, no closing remarks.",
  user: (document: string) => `Document:\n${document}\n\nReturn three bullets.`,
};
