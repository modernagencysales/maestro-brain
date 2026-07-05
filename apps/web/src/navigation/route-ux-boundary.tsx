import { useCallback, useEffect, useState, type ReactNode } from "react";
import { TemplateRouteFocusBoundary } from "@maestro-template/ui";
import { describeRouteAnnouncement } from "./route-announcements";
import { useBrowserNetworkState } from "./network-state";

export function WebRouteUxBoundary({
  children,
  href,
  pathname,
}: {
  readonly children: ReactNode;
  readonly href: string;
  readonly pathname: string;
}) {
  const [hash, setHash] = useState("");
  const networkState = useBrowserNetworkState();
  const retryCurrentRoute = useCallback(() => {
    window.location.reload();
  }, []);

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);

    updateHash();
    window.addEventListener("hashchange", updateHash);

    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

  return (
    <TemplateRouteFocusBoundary
      announcement={describeRouteAnnouncement(pathname, hash)}
      focusKey={`${href}${hash}`}
      networkAction={
        <button onClick={retryCurrentRoute} type="button">
          Retry now
        </button>
      }
      networkState={networkState}
    >
      {children}
    </TemplateRouteFocusBoundary>
  );
}
