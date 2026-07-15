import NangoFrontend from "@nangohq/frontend";

import { ConnectSessionInvalid, isSecretShapedNangoValue } from "./client";

type NangoFrontendCtor = new (config: {
  readonly connectSessionToken: string;
}) => {
  readonly openConnectUI: (params: {
    readonly sessionToken: string;
    readonly onEvent: (event: unknown) => void;
  }) => { readonly open: () => void; readonly close?: () => void };
};

export type NangoConnectOpen = (input: {
  readonly token: string;
}) => Promise<{ readonly connectionId: string }>;

export const openNangoConnect = async (input: {
  readonly connectSessionToken: string;
  readonly expiresAt: number;
  readonly open: NangoConnectOpen;
  readonly now?: number;
}): Promise<{ readonly connectionId: string }> => {
  if (
    input.expiresAt <= (input.now ?? Date.now()) ||
    isSecretShapedNangoValue(input.connectSessionToken) ||
    !input.connectSessionToken.startsWith("connect_public_")
  ) {
    throw new ConnectSessionInvalid();
  }

  return input.open({ token: input.connectSessionToken });
};

const connectionIdFromEvent = (event: unknown): string | null => {
  if (typeof event !== "object" || event === null) return null;
  const maybeEvent = event as {
    readonly type?: unknown;
    readonly payload?: {
      readonly connectionId?: unknown;
      readonly connection_id?: unknown;
    };
  };
  if (maybeEvent.type !== "connect") return null;
  const connectionId =
    maybeEvent.payload?.connectionId ?? maybeEvent.payload?.connection_id;
  return typeof connectionId === "string" && connectionId.startsWith("conn_")
    ? connectionId
    : null;
};

export const openNangoConnectWithSdk = async (input: {
  readonly connectSessionToken: string;
  readonly NangoFrontend?: NangoFrontendCtor;
}): Promise<{ readonly connectionId: string }> => {
  if (isSecretShapedNangoValue(input.connectSessionToken)) {
    throw new ConnectSessionInvalid();
  }
  const Frontend = input.NangoFrontend ?? NangoFrontend;
  const nango = new Frontend({
    connectSessionToken: input.connectSessionToken,
  });
  return await new Promise((resolve, reject) => {
    const ui = nango.openConnectUI({
      sessionToken: input.connectSessionToken,
      onEvent: (event) => {
        const connectionId = connectionIdFromEvent(event);
        if (connectionId !== null) {
          ui.close?.();
          resolve({ connectionId });
        }
        if (
          typeof event === "object" &&
          event !== null &&
          (event as { readonly type?: unknown }).type === "error"
        ) {
          ui.close?.();
          reject(new ConnectSessionInvalid());
        }
      },
    });
    ui.open();
  });
};
