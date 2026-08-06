import type { SlackLinkStatusView } from "./slack-link-adapter";

export const SlackLinkStatus = ({
  view,
}: Readonly<{ view: SlackLinkStatusView }>) => (
  <section aria-labelledby="slack-link-status-heading">
    <h2 id="slack-link-status-heading">{view.heading}</h2>
    {view.body.map((line) => (
      <p key={line}>{line}</p>
    ))}
  </section>
);
