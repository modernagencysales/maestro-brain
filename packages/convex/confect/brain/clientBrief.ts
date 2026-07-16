export type StandardClientBriefPage = {
  readonly pageKey: string;
  readonly slug: string;
  readonly title: string;
  readonly sortKey: string;
  readonly markdown: string;
};

const standardClientBriefPageTemplates = [
  {
    keySuffix: "overview",
    slug: "overview",
    title: "Overview",
    sortKey: "0000000001",
    markdown:
      "# Overview\n\nCapture the client's context, goals, and positioning.",
  },
  {
    keySuffix: "stakeholders",
    slug: "stakeholders",
    title: "Stakeholders",
    sortKey: "0000000002",
    markdown:
      "# Stakeholders\n\nTrack decision makers, contributors, and reviewers.",
  },
  {
    keySuffix: "decisions",
    slug: "decisions",
    title: "Decisions",
    sortKey: "0000000003",
    markdown: "# Decisions\n\nRecord important decisions and their rationale.",
  },
  {
    keySuffix: "commitments_next_steps",
    slug: "commitments-and-next-steps",
    title: "Commitments and next steps",
    sortKey: "0000000004",
    markdown:
      "# Commitments and next steps\n\nList owners, promises, deadlines, and immediate next steps.",
  },
  {
    keySuffix: "risks_open_questions",
    slug: "risks-and-open-questions",
    title: "Risks and open questions",
    sortKey: "0000000005",
    markdown:
      "# Risks and open questions\n\nSurface unresolved risks, blockers, and follow-up questions.",
  },
  {
    keySuffix: "proof_assets",
    slug: "proof-and-assets",
    title: "Proof and assets",
    sortKey: "0000000006",
    markdown:
      "# Proof and assets\n\nCollect citations, proof points, links, and launch assets.",
  },
] as const;

export const buildStandardClientBriefPages = (
  brainKey: string,
): readonly StandardClientBriefPage[] =>
  standardClientBriefPageTemplates.map((page) => ({
    pageKey: `pag_${brainKey.toLowerCase().replaceAll("-", "_")}_${page.keySuffix}`,
    slug: page.slug,
    title: page.title,
    sortKey: page.sortKey,
    markdown: page.markdown,
  }));

export const standardClientBriefPages =
  buildStandardClientBriefPages("client_brief");
