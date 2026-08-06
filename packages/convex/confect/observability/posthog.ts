import { PostHog } from "@posthog/convex";
import {
  createConfectFailureEvent,
  createBrainMetricEvent,
  type BrainMetricInput,
  type CapturedFailureKind,
} from "@maestro-template/observability";
import type { Scheduler } from "convex/server";
import * as Effect from "effect/Effect";

import { components } from "../../convex/_generated/api";

export const posthog = new PostHog(components.posthog);

export type SchedulerCtx = {
  readonly scheduler: Scheduler;
};

export type CaptureFailureInput = {
  readonly functionPath: string;
  readonly kind: CapturedFailureKind;
  readonly errorTag: string;
  readonly errorMessage: string;
  readonly causeHash: string;
  readonly workspaceId?: string;
  readonly userId?: string;
};

export const captureFailure = (
  ctx: SchedulerCtx,
  input: CaptureFailureInput,
): Effect.Effect<void, unknown> =>
  Effect.tryPromise(() =>
    posthog.capture(ctx, createConfectFailureEvent(input)),
  ).pipe(Effect.asVoid);

export const captureBrainMetric = (
  ctx: SchedulerCtx,
  input: BrainMetricInput,
): Effect.Effect<void, unknown> =>
  Effect.tryPromise(() =>
    posthog.capture(ctx, createBrainMetricEvent(input)),
  ).pipe(Effect.asVoid);
