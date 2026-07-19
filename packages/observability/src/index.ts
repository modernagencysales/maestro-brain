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
  readonly release?: string;
  readonly environment?: string;
  readonly severity?: ErrorReportSeverity;
  readonly handled?: boolean;
  readonly tags?: Readonly<Record<string, string>>;
};

export type ErrorReportSeverity = "info" | "warning" | "error" | "fatal";

export type ErrorReporterEvent = {
  readonly type: "template.error";
  readonly message: string;
  readonly name: string;
  readonly fingerprint: string;
  readonly severity: ErrorReportSeverity;
  readonly handled: boolean;
  readonly release: string;
  readonly environment: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly tags: Readonly<Record<string, string>>;
};

export type CapturedFailureKind = "mutation" | "action";

export type CapturedConfectFailure = {
  readonly functionPath: string;
  readonly kind: CapturedFailureKind;
  readonly errorTag: string;
  readonly errorMessage: string;
  readonly causeHash: string;
  readonly workspaceId?: string;
  readonly userId?: string;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRedactedField = (field: string): boolean =>
  redactedFields.includes(field as (typeof redactedFields)[number]);

const redactObservabilityValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactObservabilityValue(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = isRedactedField(key)
      ? "[redacted]"
      : redactObservabilityValue(nested);
  }

  return redacted;
};

export const redactObservabilityPayload = (
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> =>
  redactObservabilityValue(payload) as Record<string, unknown>;

export const createConfectFailureEvent = (
  failure: CapturedConfectFailure,
): PostHogEvent => ({
  event: "template.confect.failure",
  distinctId: failure.userId ?? "system",
  properties: redactObservabilityPayload({
    functionPath: failure.functionPath,
    kind: failure.kind,
    errorTag: failure.errorTag,
    errorMessage: failure.errorMessage,
    causeHash: failure.causeHash,
    workspaceId: failure.workspaceId,
  }),
});

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

const hashString = (value: string): string => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `err_${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "UnknownError";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error captured.";

export const normalizeErrorReport = (
  report: ErrorReport,
): ErrorReporterEvent => {
  const name = errorName(report.error);
  const message = errorMessage(report.error);
  const release = report.release?.trim() || "unreleased";
  const environment = report.environment?.trim() || "unknown";

  return {
    type: "template.error",
    name,
    message: "Error captured.",
    fingerprint: hashString(`${name}:${message}:${release}:${environment}`),
    severity: report.severity ?? "error",
    handled: report.handled ?? false,
    release,
    environment,
    context: redactObservabilityPayload(report.context),
    tags: report.tags ?? {},
  };
};

export const createErrorReporter = (options: {
  readonly mode: ObservabilityMode;
  readonly sink?: (event: ErrorReporterEvent) => void | Promise<void>;
}) => ({
  report: async (report: ErrorReport): Promise<ObservabilityResult> => {
    try {
      await options.sink?.(normalizeErrorReport(report));

      return { ok: true, delivery: deliveryForMode(options.mode) };
    } catch {
      return { ok: false, delivery: "dropped", retryable: true };
    }
  },
});

export * from "./brainMetrics";
