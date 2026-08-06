import { describe, expect, it } from "vitest";
import { createBrainMetricEvent } from "./brainMetrics";
import { redactObservabilityPayload } from "./index";

describe("Brain metrics", () => {
  it("emits only bounded metric dimensions", () => {
    expect(
      createBrainMetricEvent({
        metric: "ask_error",
        value: 1,
        unit: "count",
        workspaceId: "workspace_123",
        subsystem: "ask",
        errorTag: "ValidationFailed",
        generation: 4,
      }),
    ).toEqual({
      event: "maestro.brain.metric",
      distinctId: "system",
      properties: {
        metric: "ask_error",
        value: 1,
        unit: "count",
        workspaceId: "workspace_123",
        subsystem: "ask",
        errorTag: "ValidationFailed",
        generation: 4,
      },
    });
  });

  it("redacts secret-shaped fields before delivery", () => {
    const event = createBrainMetricEvent({
      metric: "queue_depth",
      value: 2,
      unit: "count",
    });
    const properties = redactObservabilityPayload({
      ...event.properties,
      token: "secret",
    });
    expect(properties).toMatchObject({ token: "[redacted]" });
    expect(properties).not.toHaveProperty("question");
  });
});
