export const NANGO_SLACK_PROVIDER = "slack";

export type SlackNangoConnection = {
  readonly connectionId: string;
  readonly teamId?: string;
  readonly botUserId?: string;
};
