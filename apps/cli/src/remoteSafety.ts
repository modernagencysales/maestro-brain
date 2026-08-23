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

const isObjectRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object";

export const containsTenantSelector = (value: unknown): boolean => {
  if (!isObjectRecord(value)) return false;
  if (Array.isArray(value)) return value.some(containsTenantSelector);
  return Object.entries(value).some(
    ([name, nested]) =>
      tenantSelectorNames.has(name) || containsTenantSelector(nested),
  );
};

const isTrimmedValue = (value: string | undefined): value is string =>
  value !== undefined && value.trim() === value;

const usesAllowedProtocol = (url: URL): boolean => {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && url.hostname.toLowerCase() === "localhost";
};

const hasNoCredentials = (url: URL): boolean =>
  url.username === "" && url.password === "";

const hasNoExtraUrlParts = (url: URL): boolean =>
  url.pathname === "/" && url.search === "" && url.hash === "";

const isValidBrainOrigin = (url: URL): boolean =>
  usesAllowedProtocol(url) && hasNoCredentials(url) && hasNoExtraUrlParts(url);

export const brainApiOrigin = (
  value: string | undefined,
): string | undefined => {
  if (!isTrimmedValue(value)) return undefined;
  try {
    const url = new URL(value);
    return isValidBrainOrigin(url) ? url.origin : undefined;
  } catch {
    return undefined;
  }
};
