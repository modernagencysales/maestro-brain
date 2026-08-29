export const slackEvidenceScopeKey = (input: {
  readonly connectionRef: string;
  readonly channelId: string;
  readonly lookbackDays: number;
}): string =>
  `slack:${encodeURIComponent(input.connectionRef)}:channel:${encodeURIComponent(input.channelId)}:lookback:${input.lookbackDays}`;
