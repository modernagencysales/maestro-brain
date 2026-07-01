import * as Schema from "effect/Schema";

export type ProviderMode = "fake" | "test" | "live";

export type ProviderId =
  | "workos"
  | "posthog"
  | "dodo"
  | "mailersend"
  | "openrouter"
  | "storage"
  | "search";

export type ProviderFamily =
  "auth" | "analytics" | "billing" | "email" | "llm" | "storage" | "search";

export type ProviderDescriptor = {
  readonly id: ProviderId;
  readonly family: ProviderFamily;
  readonly displayName: string;
  readonly fakeMode: boolean;
  readonly liveMode: boolean;
  readonly requiredEnv: readonly string[];
  readonly redactedFields: readonly string[];
  readonly notes: string;
};

export class ProviderConfigError extends Schema.TaggedError<ProviderConfigError>()(
  "ProviderConfigError",
  {
    provider: Schema.String,
    missingEnv: Schema.Array(Schema.String),
  },
) {}

export class ProviderCallError extends Schema.TaggedError<ProviderCallError>()(
  "ProviderCallError",
  {
    provider: Schema.String,
    publicMessage: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

export const providerDescriptors = [
  {
    id: "workos",
    family: "auth",
    displayName: "WorkOS/AuthKit",
    fakeMode: true,
    liveMode: true,
    requiredEnv: ["WORKOS_API_KEY", "WORKOS_CLIENT_ID"],
    redactedFields: ["apiKey", "sessionToken", "organizationId"],
    notes:
      "Workspace membership and organization provisioning sit behind AuthWorkspace.",
  },
  {
    id: "posthog",
    family: "analytics",
    displayName: "PostHog",
    fakeMode: true,
    liveMode: true,
    requiredEnv: ["POSTHOG_KEY", "POSTHOG_HOST"],
    redactedFields: ["distinctId", "personProperties"],
    notes: "Event contracts are typed before live analytics is enabled.",
  },
  {
    id: "dodo",
    family: "billing",
    displayName: "Dodo",
    fakeMode: true,
    liveMode: true,
    requiredEnv: ["DODO_API_KEY", "DODO_WEBHOOK_SECRET"],
    redactedFields: ["apiKey", "webhookSecret", "customerEmail"],
    notes:
      "Billing defaults to fake packages, entitlements, and credit ledger state.",
  },
  {
    id: "mailersend",
    family: "email",
    displayName: "MailerSend",
    fakeMode: true,
    liveMode: true,
    requiredEnv: ["MAILERSEND_API_KEY", "MAILERSEND_FROM_EMAIL"],
    redactedFields: ["apiKey", "recipient", "templateData"],
    notes: "Console/fake delivery is the default local path.",
  },
  {
    id: "openrouter",
    family: "llm",
    displayName: "OpenRouter-compatible LLM",
    fakeMode: true,
    liveMode: true,
    requiredEnv: ["OPENROUTER_API_KEY"],
    redactedFields: ["apiKey", "prompt", "completion", "sourceContent"],
    notes:
      "Provider payloads are never public errors and source content is never instructions.",
  },
  {
    id: "storage",
    family: "storage",
    displayName: "Object Storage",
    fakeMode: true,
    liveMode: true,
    requiredEnv: ["STORAGE_BUCKET", "STORAGE_SIGNING_SECRET"],
    redactedFields: ["signedUrl", "objectKey", "sourceExcerpt"],
    notes: "Signed URLs are scoped, expiring, and workspace-bound.",
  },
  {
    id: "search",
    family: "search",
    displayName: "Optional Search",
    fakeMode: true,
    liveMode: true,
    requiredEnv: ["SEARCH_PROVIDER", "SEARCH_API_KEY"],
    redactedFields: ["apiKey", "queryText", "documentChunk"],
    notes:
      "Vector/RAG retrieval is optional; source sets and context packs are core.",
  },
] as const satisfies readonly ProviderDescriptor[];

export const providerIds = providerDescriptors.map((provider) => provider.id);

export const getProviderDescriptor = (
  id: ProviderId,
): ProviderDescriptor | undefined =>
  providerDescriptors.find((provider) => provider.id === id);

export const validateProviderConfig = (
  id: ProviderId,
  mode: ProviderMode,
  env: Record<string, string | undefined>,
): true | ProviderConfigError => {
  if (mode !== "live") {
    return true;
  }

  const descriptor = getProviderDescriptor(id);
  const missingEnv =
    descriptor?.requiredEnv.filter((name) => !env[name]?.trim()) ?? [];

  if (missingEnv.length === 0) {
    return true;
  }

  return new ProviderConfigError({
    provider: id,
    missingEnv,
  });
};

export const redactProviderPayload = (
  id: ProviderId,
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const descriptor = getProviderDescriptor(id);
  const redacted = { ...payload };

  for (const field of descriptor?.redactedFields ?? []) {
    if (field in redacted) {
      redacted[field] = "[redacted]";
    }
  }

  return redacted;
};

export const providerConfigReport = (
  mode: ProviderMode,
  env: Record<string, string | undefined>,
) =>
  providerDescriptors.map((provider) => {
    const validation = validateProviderConfig(provider.id, mode, env);

    return {
      id: provider.id,
      displayName: provider.displayName,
      family: provider.family,
      mode,
      ready: validation === true,
      missingEnv: validation === true ? [] : validation.missingEnv,
      requiredEnv: provider.requiredEnv,
      fakeMode: provider.fakeMode,
      liveMode: provider.liveMode,
    };
  });
