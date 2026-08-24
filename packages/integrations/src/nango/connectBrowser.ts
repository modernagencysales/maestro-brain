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

type ConnectEvent = Readonly<{
  type?: unknown;
  payload?: {
    connectionId?: unknown;
    connection_id?: unknown;
  };
}>;

const parseEvent = (event: unknown): ConnectEvent | undefined =>
  typeof event === "object" && event !== null
    ? (event as ConnectEvent)
    : undefined;

const connectionIdFrom = (event: ConnectEvent): string | undefined => {
  const value = event.payload?.connectionId ?? event.payload?.connection_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

type ConnectUi = { readonly open: () => void; readonly close?: () => void };

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

class ConnectEventController {
  private settled = false;
  private ui: ConnectUi | undefined;

  constructor(
    private readonly resolve: (value: { connectionId: string }) => void,
    private readonly reject: (error: Error) => void,
  ) {}

  attach(ui: ConnectUi) {
    this.ui = ui;
  }

  private finish(result: { connectionId: string } | { error: Error }) {
    if (this.settled) return;
    this.settled = true;
    this.ui?.close?.();
    if ("connectionId" in result) this.resolve(result);
    else this.reject(result.error);
  }

  readonly onEvent = (event: unknown) => {
    const value = parseEvent(event);
    if (value === undefined) return;
    const connectionId = connectionIdFrom(value);
    if (value.type === "connect" && connectionId !== undefined)
      this.finish({ connectionId });
    if (value.type === "close")
      this.finish({ error: new NangoConnectCancelled() });
    if (value.type === "error")
      this.finish({
        error: new Error("Unable to complete Slack authorization."),
      });
  };
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
  const pending = deferred<{ readonly connectionId: string }>();
  const controller = new ConnectEventController(
    pending.resolve,
    pending.reject,
  );
  const ui = client.openConnectUI({
    sessionToken: input.connectSessionToken,
    onEvent: controller.onEvent,
  });
  controller.attach(ui);
  ui.open();
  return pending.promise;
};
