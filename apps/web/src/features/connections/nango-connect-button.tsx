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
  readonly cancel: (input: {
    readonly connectSessionId: string;
  }) => Promise<void>;
  readonly log?: (event: string, metadata: Record<string, unknown>) => void;
}): Promise<SlackConnectResult | undefined> => {
  const session = await input.begin();
  let connectionId: string;
  try {
    ({ connectionId } = await openNangoConnect({
      ...session,
      open: input.open,
    }));
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      (error as { readonly _tag?: unknown })._tag !== "NangoConnectCancelled"
    )
      throw error;
    await input.cancel({ connectSessionId: session.connectSessionId });
    return undefined;
  }
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
  providerName = "Slack",
  status,
  onConnect,
}: {
  readonly enabled: boolean;
  readonly providerName?: string;
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
      ? `Reauthorize ${providerName}`
      : status === "verifying"
        ? `Verifying ${providerName}`
        : status === "reauthorizing"
          ? `Reauthorizing ${providerName}`
          : `Connect ${providerName}`;
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
