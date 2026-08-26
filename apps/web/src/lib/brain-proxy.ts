import { configuredConvexRuntimeUrl } from "../env";

export const convexSiteOrigin = (configured: string): string => {
  const url = new URL(configured);
  if (url.hostname.endsWith(".convex.cloud"))
    url.hostname = url.hostname.replace(/\.convex\.cloud$/u, ".convex.site");
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
};

export const configuredBrainApiOrigin = (): string | undefined => {
  const value = configuredConvexRuntimeUrl();
  return value ? convexSiteOrigin(value) : undefined;
};
