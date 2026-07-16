import { describe, expect, it } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { MutationCtx } from "../confect/_generated/services";
import { Forbidden } from "../confect/errors";
import {
  errorFromCause,
  withMutationErrorCapture,
} from "../confect/observability/errorCapture";

describe("Confect observability error capture", () => {
  it("extracts tagged Effect failures without exposing raw cause text", () => {
    const captured = errorFromCause(
      Cause.fail(new Forbidden({ reason: "denied" })),
    );

    expect(captured.tag).toBe("Forbidden");
    expect(captured.message).toBe("denied");
    expect(captured.hash).toMatch(/^cause_/);
  });

  it("classifies defects without exposing defect details", () => {
    const captured = errorFromCause(Cause.die(new Error("raw defect detail")));

    expect(captured).toMatchObject({
      tag: "EffectDefect",
      message: "Effect failed with a defect.",
    });
    expect(captured.hash).toMatch(/^cause_/);
  });

  it("suppresses capture failures and preserves the original typed failure", async () => {
    const failure = new Forbidden({ reason: "denied" });
    const ctx = {
      scheduler: {
        runAfter: async () => {
          throw new Error("PostHog unavailable");
        },
      },
    };

    const exit = await Effect.runPromiseExit(
      withMutationErrorCapture(
        "brain/pages.create",
        Effect.fail(failure),
      ).pipe(Effect.provideService(MutationCtx, ctx as never)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag !== "Failure") {
      return;
    }

    const capturedFailure = Cause.failureOption(exit.cause);
    expect(capturedFailure._tag).toBe("Some");
    if (capturedFailure._tag === "Some") {
      expect(capturedFailure.value).toBe(failure);
    }
  });
});
