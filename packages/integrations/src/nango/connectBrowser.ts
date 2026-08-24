type NangoFrontendConstructor = new (config: {
  readonly connectSessionToken: string;
}) => {
  readonly openConnectUI: (input: {
    readonly sessionToken: string;
    readonly onEvent: (event: unknown) => void;
  }) => { readonly open: () => void; readonly close?: () => void };
};

export class NangoConnectCancelled extends Error {
  readonly _tag = "NangoConnectCancelled";
}

export const openNangoConnect = async (input: {
  readonly connectSessionToken: string;
  readonly NangoFrontend?: NangoFrontendConstructor;
}): Promise<{ readonly connectionId: string }> => {
  const Frontend =
    input.NangoFrontend ?? (await import("@nangohq/frontend")).default;
  const client = new Frontend({
    connectSessionToken: input.connectSessionToken,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const ui = client.openConnectUI({
      sessionToken: input.connectSessionToken,
      onEvent: (event) => {
        if (settled || typeof event !== "object" || event === null) return;
        const value = event as {
          readonly type?: unknown;
          readonly payload?: {
            readonly connectionId?: unknown;
            readonly connection_id?: unknown;
          };
        };
        const connectionId =
          value.payload?.connectionId ?? value.payload?.connection_id;
        if (
          value.type === "connect" &&
          typeof connectionId === "string" &&
          connectionId.length > 0
        ) {
          settled = true;
          ui.close?.();
          resolve({ connectionId });
        } else if (value.type === "close") {
          settled = true;
          ui.close?.();
          reject(new NangoConnectCancelled());
        } else if (value.type === "error") {
          settled = true;
          ui.close?.();
          reject(new Error("Unable to complete Slack authorization."));
        }
      },
    });
    ui.open();
  });
};
