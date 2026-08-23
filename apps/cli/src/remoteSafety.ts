const tenantSelectorNames = new Set([
  "organizationId",
  "organizationKey",
  "agencyKey",
  "workspaceId",
  "workspaceKey",
  "workspaceSlug",
  "brainId",
  "brainKey",
  "userId",
  "memberId",
  "keyId",
  "apiKeyId",
  "_id",
  "id",
]);

export const containsTenantSelector = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsTenantSelector);
  return Object.entries(value).some(
    ([name, nested]) =>
      tenantSelectorNames.has(name) || containsTenantSelector(nested),
  );
};

export const brainApiOrigin = (
  value: string | undefined,
): string | undefined => {
  if (value === undefined || value.trim() !== value) return undefined;
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" && url.hostname.toLowerCase() === "localhost";
    return (url.protocol === "https:" || localHttp) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
};
