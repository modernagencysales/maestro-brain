import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { runFrontendEffectBoundary } from "./effectBoundary";

describe("frontend Effect boundary adapter", () => {
  it("normalizes successful frontend effects as mutation success", async () => {
    await expect(runFrontendEffectBoundary(Effect.succeed(1))).resolves.toEqual(
      {
        status: "ready",
        mode: "read",
        data: 1,
        mutation: "success",
      },
    );
  });

  it("preserves typed failures separately from defects", async () => {
    await expect(
      runFrontendEffectBoundary(Effect.fail({ _tag: "Denied" as const })),
    ).resolves.toEqual({
      status: "typed_failure",
      error: { _tag: "Denied" },
    });
  });

  it("maps defects to the defect mutation state", async () => {
    await expect(
      runFrontendEffectBoundary(Effect.die(new Error("boom"))),
    ).resolves.toMatchObject({
      status: "defect",
      message: "boom",
    });
  });

  it("returns transport failure when the action is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runFrontendEffectBoundary(Effect.succeed(1), {
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      status: "transport_failure",
      message: "Action aborted.",
    });
  });
});
