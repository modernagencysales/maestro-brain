type SlackLinkButtonProps = Readonly<{
  canLink: boolean;
  status: "unlinked" | "active";
  bindingGeneration?: number;
}>;

export const SlackLinkButton = ({
  canLink,
  status,
  bindingGeneration,
}: SlackLinkButtonProps) => (
  <button type="button" disabled={!canLink}>
    {status === "active" ? "Relink Slack identity" : "Link Slack identity"}
    {status === "active" && bindingGeneration !== undefined
      ? ` (generation ${bindingGeneration})`
      : null}
  </button>
);
