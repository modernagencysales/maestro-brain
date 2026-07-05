import { useEffect, useState, type ReactNode } from "react";
import { TemplateRouteFocusBoundary } from "@maestro-template/ui";
import { describeRouteAnnouncement } from "./route-announcements";

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
    >
      {children}
    </TemplateRouteFocusBoundary>
  );
}
