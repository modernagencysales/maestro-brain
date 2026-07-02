export type WebEnv = {
  readonly VITE_CONVEX_URL: string;
};

const fallbackConvexUrl = "https://example-template.convex.cloud";

export const getWebEnv = (): WebEnv => ({
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL?.trim() || fallbackConvexUrl,
});

/**
 * True when a real deployment URL was baked in at build time. Static/local
 * builds without VITE_CONVEX_URL fall back to a placeholder host; live
 * features should render their "not configured" state instead of dialing it.
 */
export const isConvexConfigured = (): boolean =>
  (import.meta.env.VITE_CONVEX_URL?.trim() ?? "").length > 0;
