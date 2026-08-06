import * as Schema from "effect/Schema";

const CitedFact = Schema.Struct({
  text: Schema.String,
  citationKeys: Schema.Array(Schema.String),
});
const Commitment = Schema.extend(
  CitedFact,
  Schema.Struct({
    owner: Schema.optional(Schema.String),
    dueDate: Schema.optional(Schema.String),
  }),
);
const PageProposal = Schema.Struct({
  brainKey: Schema.String,
  pageKey: Schema.String,
  title: Schema.String,
  markdown: Schema.String,
  citationKeys: Schema.Array(Schema.String),
});

export const MinedCall = Schema.Struct({
  summary: Schema.String,
  summaryCitationKeys: Schema.Array(Schema.String),
  decisions: Schema.Array(CitedFact),
  commitments: Schema.Array(Commitment),
  risks: Schema.Array(CitedFact),
  stakeholderChanges: Schema.Array(CitedFact),
  pageProposals: Schema.Array(PageProposal),
});
export type MinedCall = typeof MinedCall.Type;

export const decodeMinedCall = (
  raw: unknown,
  context: {
    readonly brainKey: string;
    readonly pageKeys?: readonly string[];
    readonly citations: readonly {
      readonly citationKey: string;
      readonly quote: string;
    }[];
  },
): MinedCall => {
  const output = Schema.decodeUnknownSync(MinedCall)(raw);
  const facts = [
    ...output.decisions,
    ...output.commitments,
    ...output.risks,
    ...output.stakeholderChanges,
  ];
  const citationKeys = [
    ...(output.summary ? output.summaryCitationKeys : []),
    ...facts.flatMap(({ citationKeys }) => citationKeys),
    ...output.pageProposals.flatMap(({ citationKeys }) => citationKeys),
  ];
  if (
    (output.summary && output.summaryCitationKeys.length === 0) ||
    facts.some(({ text, citationKeys }) => text && citationKeys.length === 0) ||
    output.pageProposals.some(({ citationKeys }) => citationKeys.length === 0)
  )
    throw new Error("factual output requires a citation");
  const citations = new Map(
    context.citations.map((citation) => [citation.citationKey, citation.quote]),
  );
  if (citationKeys.some((citationKey) => !citations.has(citationKey)))
    throw new Error("unknown citation");
  if (
    output.pageProposals.some(
      ({ brainKey, pageKey }) =>
        brainKey !== context.brainKey ||
        (context.pageKeys !== undefined && !context.pageKeys.includes(pageKey)),
    )
  )
    throw new Error("page proposal targets an unauthorized Brain page");
  for (const commitment of output.commitments) {
    const evidence = commitment.citationKeys
      .map((citationKey) => citations.get(citationKey) ?? "")
      .join(" ")
      .toLowerCase();
    if (
      (commitment.owner &&
        !evidence.includes(commitment.owner.toLowerCase())) ||
      (commitment.dueDate &&
        !evidence.includes(commitment.dueDate.toLowerCase()))
    )
      throw new Error("owner or due date is not cited");
  }
  return output;
};
