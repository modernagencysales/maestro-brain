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

export class NangoConnectCancelled extends Error {
  readonly _tag = "NangoConnectCancelled";
}

export const openNangoConnect = async (input: {
  readonly connectSessionToken: string;
  readonly expiresAt: number;
  readonly open: NangoConnectOpen;
  readonly now?: number;
}): Promise<{ readonly connectionId: string }> => {
  if (
    input.expiresAt <= (input.now ?? Date.now()) ||
    isSecretShapedNangoValue(input.connectSessionToken)
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
  return typeof connectionId === "string" && connectionId.trim().length > 0
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
    let settled = false;
    const ui = nango.openConnectUI({
      sessionToken: input.connectSessionToken,
      onEvent: (event) => {
        if (settled) return;
        const connectionId = connectionIdFromEvent(event);
        if (connectionId !== null) {
          settled = true;
          ui.close?.();
          resolve({ connectionId });
          return;
        }
        if (typeof event !== "object" || event === null) return;
        const eventType = (event as { readonly type?: unknown }).type;
        if (eventType === "close") {
          settled = true;
          ui.close?.();
          reject(new NangoConnectCancelled());
        } else if (eventType === "error") {
          settled = true;
          ui.close?.();
          reject(new ConnectSessionInvalid());
        }
      },
    });
    ui.open();
  });
};
