import { useEffect, useState } from "react";

export type WebNetworkState = "online" | "offline" | "degraded";

type NetworkLike = {
  readonly onLine?: boolean;
};

const browserHasNetworkApi = (): boolean =>
  typeof window !== "undefined" && typeof navigator !== "undefined";

export const networkStateFromNavigator = (
  navigatorLike: NetworkLike | undefined,
): WebNetworkState => (navigatorLike?.onLine === false ? "offline" : "online");

export function readBrowserNetworkState(): WebNetworkState {
  return browserHasNetworkApi()
    ? networkStateFromNavigator(navigator)
    : "online";
}

export function useBrowserNetworkState(): WebNetworkState {
  const [networkState, setNetworkState] = useState<WebNetworkState>(() =>
    readBrowserNetworkState(),
  );

  useEffect(() => {
    if (!browserHasNetworkApi()) {
      return;
    }

    const refreshNetworkState = () =>
      setNetworkState(readBrowserNetworkState());

    refreshNetworkState();
    window.addEventListener("online", refreshNetworkState);
    window.addEventListener("offline", refreshNetworkState);

    return () => {
      window.removeEventListener("online", refreshNetworkState);
      window.removeEventListener("offline", refreshNetworkState);
    };
  }, []);

  return networkState;
}
