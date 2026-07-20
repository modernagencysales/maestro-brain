import type { SlackLinkBinding } from "./slack-link-adapter";

export const SlackLinkButton = ({
  canLink,
  status,
  bindingGeneration,
}: {
  readonly canLink: boolean;
  readonly status: SlackLinkBinding["status"] | "unlinked";
  readonly bindingGeneration?: number | undefined;
}) => {
  const label =
    status === "active" ? "Relink Slack identity" : "Link Slack identity";
  return (
    <button type="button" disabled={!canLink} aria-disabled={!canLink}>
      {label}
      {status === "active" && bindingGeneration !== undefined
        ? ` — generation ${bindingGeneration}`
        : ""}
    </button>
  );
};
