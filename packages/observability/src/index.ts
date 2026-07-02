export type ObservabilityMode = "fake" | "test" | "live";

export type ObservabilityDelivery = "fake" | "test" | "live-ready" | "dropped";

export type ObservabilityResult = {
  readonly ok: boolean;
  readonly delivery: ObservabilityDelivery;
  readonly retryable?: boolean;
};

export type PostHogEvent = {
  readonly event: string;
  readonly distinctId: string;
  readonly properties: Readonly<Record<string, unknown>>;
};

export type ErrorReport = {
  readonly error: unknown;
  readonly context: Readonly<Record<string, unknown>>;
};

const redactedFields = [
  "apiKey",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "authorization",
  "password",
] as const;

export const redactObservabilityPayload = (
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    redacted[key] = redactedFields.includes(
      key as (typeof redactedFields)[number],
    )
      ? "[redacted]"
      : value;
  }

  return redacted;
};

const deliveryForMode = (mode: ObservabilityMode): ObservabilityDelivery =>
  mode === "fake" ? "fake" : mode === "test" ? "test" : "live-ready";

export const createPostHogCapture = (options: {
  readonly mode: ObservabilityMode;
  readonly sink?: (event: PostHogEvent) => void | Promise<void>;
}) => ({
  capture: async (event: PostHogEvent): Promise<ObservabilityResult> => {
    try {
      await options.sink?.({
        ...event,
        properties: redactObservabilityPayload(event.properties),
      });

      return { ok: true, delivery: deliveryForMode(options.mode) };
    } catch {
      return { ok: false, delivery: "dropped", retryable: true };
    }
  },
});

export const createErrorReporter = (options: {
  readonly mode: ObservabilityMode;
  readonly sink?: (
    event: Readonly<Record<string, unknown>>,
  ) => void | Promise<void>;
}) => ({
  report: async (report: ErrorReport): Promise<ObservabilityResult> => {
    try {
      await options.sink?.({
        error:
          report.error instanceof Error
            ? {
                name: report.error.name,
                message: "Error captured.",
              }
            : "Unknown error captured.",
        context: redactObservabilityPayload(report.context),
      });

      return { ok: true, delivery: deliveryForMode(options.mode) };
    } catch {
      return { ok: false, delivery: "dropped", retryable: true };
    }
  },
});
