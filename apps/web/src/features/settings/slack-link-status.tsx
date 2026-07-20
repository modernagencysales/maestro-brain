import type { SlackLinkStatusView } from "./slack-link-adapter";

export const SlackLinkStatus = ({
  view,
}: {
  readonly view: SlackLinkStatusView;
}) => (
  <section aria-label="Slack identity link status">
    <h2>{view.heading}</h2>
    <ul>
      {view.body.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  </section>
);
