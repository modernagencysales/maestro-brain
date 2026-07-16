export type StandardClientBriefPage = {
  readonly pageKey: string;
  readonly slug: string;
  readonly title: string;
  readonly sortKey: string;
  readonly markdown: string;
};

export const standardClientBriefPages = [
  {
    pageKey: "pag_client_brief_overview",
    slug: "overview",
    title: "Overview",
    sortKey: "0000000001",
    markdown:
      "# Overview\n\nCapture the client's context, goals, and positioning.",
  },
  {
    pageKey: "pag_client_brief_stakeholders",
    slug: "stakeholders",
    title: "Stakeholders",
    sortKey: "0000000002",
    markdown:
      "# Stakeholders\n\nTrack decision makers, contributors, and reviewers.",
  },
  {
    pageKey: "pag_client_brief_decisions",
    slug: "decisions",
    title: "Decisions",
    sortKey: "0000000003",
    markdown: "# Decisions\n\nRecord important decisions and their rationale.",
  },
  {
    pageKey: "pag_client_brief_commitments_next_steps",
    slug: "commitments-and-next-steps",
    title: "Commitments and next steps",
    sortKey: "0000000004",
    markdown:
      "# Commitments and next steps\n\nList owners, promises, deadlines, and immediate next steps.",
  },
  {
    pageKey: "pag_client_brief_risks_open_questions",
    slug: "risks-and-open-questions",
    title: "Risks and open questions",
    sortKey: "0000000005",
    markdown:
      "# Risks and open questions\n\nSurface unresolved risks, blockers, and follow-up questions.",
  },
  {
    pageKey: "pag_client_brief_proof_assets",
    slug: "proof-and-assets",
    title: "Proof and assets",
    sortKey: "0000000006",
    markdown:
      "# Proof and assets\n\nCollect citations, proof points, links, and launch assets.",
  },
] as const satisfies readonly StandardClientBriefPage[];
