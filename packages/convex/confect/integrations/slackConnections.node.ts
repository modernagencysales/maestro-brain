"use node";

import { FunctionImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { MutationRunner } from "../_generated/services";
import databaseSchema from "../_generated/schema";
import slackConnections, {
  ConnectSessionInvalid,
  ProviderUnavailable,
} from "./slackConnections.spec";
import {
  generatedRefs,
  isSecretShaped,
  runSlackMutation,
} from "./slackConnections.impl";
import { readProcessEnv } from "../shared/env";

export const slackConnectBotScopes = [
  "app_mentions:read",
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "im:read",
  "im:history",
  "im:write",
  "chat:write",
  "users:read",
] as const;

type NangoSlackConnectSessionInput = Readonly<{
  organizationKey: string;
  endUserId: string;
  providerConfigKey: string;
  correlationTag: string;
}>;

export const nangoSlackConnectSessionBody = (
  input: NangoSlackConnectSessionInput,
  webhookUrl: string,
) => {
  const scopes = slackConnectBotScopes.join(",");
  return {
    allowed_integrations: [input.providerConfigKey],
    end_user: { id: input.endUserId },
    organization: { id: input.organizationKey },
    tags: { correlationTag: input.correlationTag },
    integrations_config_defaults: {
      [input.providerConfigKey]: {
        authorization_params: { scope: scopes },
        connection_config: { oauth_scopes_override: scopes },
      },
    },
    webhook_url_override: webhookUrl,
  };
};

export const resolveNangoWebhookUrl = (
  siteUrl: string | undefined,
): string | undefined => {
  const trimmed = siteUrl?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL("/webhooks/nango", trimmed);
    if (url.protocol !== "https:" || url.username || url.password)
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};

const nango = (now: number) => {
  const env = readProcessEnv();
  if ((env.APP_PROVIDER_MODE ?? "fake").trim().toLowerCase() !== "live")
    return {
      createConnectSession: async (input: {
        readonly connectSessionId: string;
      }) => ({
        connectSessionId: input.connectSessionId,
        connectSessionToken: `connect_public_${input.connectSessionId}`,
        expiresAt: now + 300_000,
      }),
      verifyConnectSession: async (input: {
        readonly connectionId: string;
        readonly connectSessionId: string;
      }) => {
        if (
          isSecretShaped(input.connectionId) ||
          !input.connectSessionId.startsWith("maestro-session-")
        )
          throw new ConnectSessionInvalid();
        const nonce = input.connectSessionId.replace(/^maestro-session-/, "");
        return {
          organizationKey: `nango-org-slack-${nonce}`,
          endUserId: `nango-user-slack-${nonce}`,
          providerConfigKey: "slack",
          correlationTag: `slack-connect:${input.connectSessionId}`,
        };
      },
    };
  const secretKey = env.NANGO_SECRET_KEY?.trim();
  const providerConfigKey = env.NANGO_CONNECT_INTEGRATION_ID?.trim();
  const webhookUrl = resolveNangoWebhookUrl(env.CONVEX_SITE_URL);
  if (!secretKey || !providerConfigKey || !webhookUrl)
    return {
      createConnectSession: async () => {
        throw new ProviderUnavailable();
      },
      verifyConnectSession: async () => {
        throw new ProviderUnavailable();
      },
    };
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`https://api.nango.dev${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) throw new ProviderUnavailable();
    return (await response.json()) as Record<string, unknown>;
  };
  return {
    createConnectSession: async (input: {
      readonly organizationKey: string;
      readonly endUserId: string;
      readonly providerConfigKey: string;
      readonly correlationTag: string;
      readonly connectSessionId: string;
    }) => {
      if (input.providerConfigKey !== providerConfigKey)
        throw new ConnectSessionInvalid();
      const body = await request("/connect/sessions", {
        method: "POST",
        body: JSON.stringify(nangoSlackConnectSessionBody(input, webhookUrl)),
      });
      const data = (body.data ?? body) as Record<string, unknown>;
      const token = data.token;
      const expiresAt = Date.parse(String(data.expires_at ?? ""));
      if (typeof token !== "string" || !Number.isFinite(expiresAt))
        throw new ProviderUnavailable();
      return {
        connectSessionId: input.connectSessionId,
        connectSessionToken: token,
        expiresAt,
      };
    },
    verifyConnectSession: async (input: {
      readonly connectionId: string;
      readonly connectSessionId: string;
    }) => {
      const body = await request(
        `/connection/${encodeURIComponent(providerConfigKey)}/${encodeURIComponent(input.connectionId)}`,
      );
      const connection = (body.data ?? body) as Record<string, unknown>;
      const endUser = (connection.end_user ?? {}) as Record<string, unknown>;
      const organization = (endUser.organization ?? {}) as Record<
        string,
        unknown
      >;
      const tags = (endUser.tags ?? connection.tags ?? {}) as Record<
        string,
        unknown
      >;
      if (
        connection.provider_config_key !== providerConfigKey ||
        typeof endUser.id !== "string" ||
        typeof organization.id !== "string" ||
        typeof tags.correlationTag !== "string"
      )
        throw new ConnectSessionInvalid();
      return {
        organizationKey: organization.id,
        endUserId: endUser.id,
        providerConfigKey,
        correlationTag: tags.correlationTag,
      };
    },
  };
};

export const beginSlackConnect = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "beginSlackConnect",
  () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const runMutation = yield* MutationRunner;
      const attemptExpiresAt = now + 300_000;
      const attempt = yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .prepareSlackConnectAttempt,
        {
          now,
          attemptExpiresAt,
          nonce: crypto.randomUUID().replace(/-/g, ""),
        },
      );
      const client = nango(now);
      const session = yield* Effect.tryPromise({
        try: () =>
          client.createConnectSession({
            organizationKey: attempt.nangoOrganizationId,
            endUserId: attempt.nangoEndUserId,
            providerConfigKey: attempt.providerConfigKey,
            correlationTag: attempt.correlationTag,
            connectSessionId: attempt.connectSessionId,
          }),
        catch: () => new ProviderUnavailable(),
      }).pipe(
        Effect.tapError(() =>
          runSlackMutation(
            runMutation,
            generatedRefs.internal.integrations.slackConnections
              .markSlackConnectAttemptFailed,
            {
              connectSessionId: attempt.connectSessionId,
              expectedConnectionGeneration: attempt.connectionGeneration,
              now,
            },
          ).pipe(Effect.ignore),
        ),
      );
      yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .reconcileSlackConnectSessionExpiry,
        {
          connectSessionId: attempt.connectSessionId,
          attemptId: attempt.attemptId,
          expectedConnectionGeneration: attempt.connectionGeneration,
          providerExpiresAt: session.expiresAt,
          localMaxExpiresAt: attemptExpiresAt,
          now,
        },
      ).pipe(
        Effect.tapError(() =>
          runSlackMutation(
            runMutation,
            generatedRefs.internal.integrations.slackConnections
              .markSlackConnectAttemptFailed,
            {
              connectSessionId: attempt.connectSessionId,
              expectedConnectionGeneration: attempt.connectionGeneration,
              now,
            },
          ).pipe(Effect.ignore),
        ),
      );
      return session;
    }),
);

export const completeSlackConnect = FunctionImpl.make(
  databaseSchema,
  slackConnections,
  "completeSlackConnect",
  (input) =>
    Effect.gen(function* () {
      if (isSecretShaped(input.connectionId))
        return yield* Effect.fail(new ConnectSessionInvalid());
      const now = yield* Clock.currentTimeMillis;
      const runMutation = yield* MutationRunner;
      const authorization = yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .authorizeSlackConnectCompletion,
        {
          connectSessionId: input.connectSessionId,
          connectionId: input.connectionId,
          now,
        },
      );
      if (authorization.alreadyCompleted)
        return {
          connectionKey: authorization.connectionKey,
          status: authorization.status,
          connectionGeneration: authorization.connectionGeneration,
        };
      const client = nango(now);
      const metadata = yield* Effect.tryPromise({
        try: () =>
          client.verifyConnectSession({
            connectSessionId: input.connectSessionId,
            connectionId: input.connectionId,
          }),
        catch: () => new ProviderUnavailable(),
      });
      yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .claimSlackConnectAttempt,
        {
          connectSessionId: input.connectSessionId,
          connectionId: input.connectionId,
          providerOrganizationKey: metadata.organizationKey,
          providerEndUserId: metadata.endUserId,
          providerConfigKey: metadata.providerConfigKey,
          correlationTag: metadata.correlationTag,
          now,
        },
      );
      const finalized = yield* runSlackMutation(
        runMutation,
        generatedRefs.internal.integrations.slackConnections
          .finalizeSlackConnectAttempt,
        {
          connectSessionId: input.connectSessionId,
          connectionId: input.connectionId,
          expectedConnectionGeneration: authorization.connectionGeneration,
          now: yield* Clock.currentTimeMillis,
        },
      );
      return {
        ...finalized,
        connectionGeneration: authorization.connectionGeneration,
      };
    }),
);
