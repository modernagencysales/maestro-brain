import { Button } from "@saas-ui/react";

import {
  openNangoConnect,
  type NangoConnectOpen,
} from "@maestro-template/integrations/nango/connectBrowser";

export type SlackConnectStatus =
  "not_connected" | "authorizing" | "active" | "error";

export type SlackConnectResult = {
  readonly connectionKey: string;
  readonly status: "verifying" | "active" | "error";
};

export const startNangoConnect = async (input: {
  readonly begin: () => Promise<{
    readonly connectSessionId: string;
    readonly connectSessionToken: string;
    readonly expiresAt: number;
  }>;
  readonly open: NangoConnectOpen;
  readonly complete: (input: {
    readonly connectionId: string;
    readonly connectSessionId: string;
  }) => Promise<SlackConnectResult>;
  readonly log?: (event: string, metadata: Record<string, unknown>) => void;
}): Promise<SlackConnectResult> => {
  const session = await input.begin();
  const { connectionId } = await openNangoConnect({
    ...session,
    open: input.open,
  });
  const result = await input.complete({
    connectionId,
    connectSessionId: session.connectSessionId,
  });
  input.log?.("slack_connect_completed", { connectionId });
  return result;
};

export function NangoConnectButton({
  enabled,
  status,
}: {
  readonly enabled: boolean;
  readonly status: SlackConnectStatus;
}) {
  const disabled = !enabled || status === "authorizing" || status === "active";
  return (
    <Button disabled={disabled} type="button">
      {status === "active" ? "Slack connected" : "Connect Slack"}
    </Button>
  );
}
