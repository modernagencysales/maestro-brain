const xmlEntities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => xmlEntities[character] ?? character);

export const xmlUserPrompt = (input: {
  readonly instruction: string;
  readonly sourceText: string;
}): string =>
  `<user_prompt><instruction>${escapeXml(input.instruction)}</instruction><source_content>${escapeXml(input.sourceText)}</source_content></user_prompt>`;
