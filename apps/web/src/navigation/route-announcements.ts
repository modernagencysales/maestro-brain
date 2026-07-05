import { referenceAppAnnouncementTitleForPageId } from "./reference-app-routes";

const routeTitles = new Map<string, string>([
  ["/", "Overview"],
  ["/_workspace/onboarding", "Onboarding"],
  ["/_workspace/legal", "Legal"],
]);

export function describeRouteAnnouncement(pathname: string, hash = ""): string {
  const hashPageId = hash.replace(/^#/, "");
  const title =
    (pathname === "/"
      ? referenceAppAnnouncementTitleForPageId(hashPageId)
      : undefined) ??
    routeTitles.get(pathname) ??
    "Unknown route";

  return `Viewing ${title}`;
}
