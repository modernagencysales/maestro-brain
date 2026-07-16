import { Button } from "@saas-ui/react";

import {
  openNangoConnect,
  type NangoConnectOpen,
} from "@maestro-template/integrations/nango/connectBrowser";

export type SlackConnectStatus =
  | "not_connected"
  | "authorizing"
  | "verifying"
  | "active"
  | "reauthorizing"
  | "error";

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
  input.log?.("slack_connect_completed", {
    provider: "nango",
    status: result.status,
  });
  return result;
};

export function NangoConnectButton({
  enabled,
  status,
  onConnect,
}: {
  readonly enabled: boolean;
  readonly status: SlackConnectStatus;
  readonly onConnect: () => void | Promise<void>;
}) {
  const disabled =
    !enabled ||
    status === "authorizing" ||
    status === "verifying" ||
    status === "reauthorizing";
  const label =
    status === "active"
      ? "Reauthorize Slack"
      : status === "verifying"
        ? "Verifying Slack"
        : status === "reauthorizing"
          ? "Reauthorizing Slack"
          : "Connect Slack";
  return (
    <Button
      disabled={disabled}
      onClick={disabled ? undefined : onConnect}
      type="button"
    >
      {label}
    </Button>
  );
}
