import * as Schema from "effect/Schema";
import { ConvexError } from "convex/values";

const invalidMinedCall = (message: string) =>
  new ConvexError({ code: "INVALID_MINED_CALL", message });

const CitedFact = Schema.Struct({
  text: Schema.String,
  citationKeys: Schema.Array(Schema.String),
});
const Commitment = Schema.extend(
  CitedFact,
  Schema.Struct({
    owner: Schema.NullOr(Schema.String),
    dueDate: Schema.NullOr(Schema.String),
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
  const citations = new Map(
    context.citations.map((citation) => [citation.citationKey, citation.quote]),
  );
  const pageProposals = output.pageProposals.map((proposal) => ({
    ...proposal,
    citationKeys: proposal.citationKeys.filter((citationKey) =>
      citations.has(citationKey),
    ),
  }));
  const commitments = output.commitments.map((commitment) => {
    const evidence = commitment.citationKeys
      .map((citationKey) => citations.get(citationKey) ?? "")
      .join(" ")
      .toLowerCase();
    return {
      ...commitment,
      owner:
        commitment.owner && evidence.includes(commitment.owner.toLowerCase())
          ? commitment.owner
          : null,
      dueDate:
        commitment.dueDate &&
        evidence.includes(commitment.dueDate.toLowerCase())
          ? commitment.dueDate
          : null,
    };
  });
  const normalizedOutput = { ...output, commitments, pageProposals };
  const facts = [
    ...normalizedOutput.decisions,
    ...normalizedOutput.commitments,
    ...normalizedOutput.risks,
    ...normalizedOutput.stakeholderChanges,
  ];
  const claimCitationKeys = [
    ...(normalizedOutput.summary ? normalizedOutput.summaryCitationKeys : []),
    ...facts.flatMap(({ citationKeys }) => citationKeys),
  ];
  if (claimCitationKeys.some((citationKey) => !citations.has(citationKey)))
    throw invalidMinedCall("unknown citation");
  const citationKeys = [
    ...claimCitationKeys,
    ...normalizedOutput.pageProposals.flatMap(
      ({ citationKeys }) => citationKeys,
    ),
  ];
  if (
    (normalizedOutput.summary &&
      normalizedOutput.summaryCitationKeys.length === 0) ||
    facts.some(({ text, citationKeys }) => text && citationKeys.length === 0) ||
    normalizedOutput.pageProposals.some(
      ({ citationKeys }) => citationKeys.length === 0,
    )
  )
    throw invalidMinedCall("factual output requires a citation");
  if (citationKeys.some((citationKey) => !citations.has(citationKey)))
    throw invalidMinedCall("unknown citation");
  if (
    normalizedOutput.pageProposals.some(
      ({ brainKey, pageKey }) =>
        brainKey !== context.brainKey ||
        (context.pageKeys !== undefined && !context.pageKeys.includes(pageKey)),
    )
  )
    throw invalidMinedCall("page proposal targets an unauthorized Brain page");
  return normalizedOutput;
};
