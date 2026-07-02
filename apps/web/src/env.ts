export type WebEnv = {
  readonly VITE_CONVEX_URL: string;
};

const fallbackConvexUrl = "https://example-template.convex.cloud";

export const getWebEnv = (): WebEnv => ({
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL?.trim() || fallbackConvexUrl,
});
