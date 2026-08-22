import { readFileSync } from "node:fs";
import { Ref } from "@confect/core";
import { describe, expect, it } from "vitest";

import { brainReadApiRefs } from "../brain/brain-read-contract";
import type { BrainRolloutStatusData } from "../brain/brain-read-contract";
import {
  rolloutBlockedFixture,
  rolloutCapacityFixture,
  rolloutCurrentFixture,
  rolloutDeadLetterFixture,
  rolloutIntegrityFixture,
  rolloutPartialFixture,
  rolloutPausedFixture,
  rolloutStaleFixture,
  rolloutUnavailableFixture,
} from "../brain/brain-read-fixtures";
import {
  buildBrainRolloutHealthBoardView,
  toBrainRolloutHealthBoardView,
} from "./health-surface";

const rolloutTargetResolutionFixture: BrainRolloutStatusData = {
  ...rolloutCurrentFixture,
  readiness: "blocked",
  promotionReady: false,
  scopes: rolloutCurrentFixture.scopes.map((scope) => ({
    ...scope,
    readiness: "blocked",
    targetResolution: {
      counts: [{ state: "retry_wait", count: 1, truncated: false }],
      unresolvedCount: 1,
      oldestUnresolvedAt: rolloutCurrentFixture.evaluatedAt - 1_000,
      truncated: false,
    },
    blockers: ["target_resolution_intents_unresolved"],
  })),
};

describe("Brain rollout health surface", () => {
  it("covers the canonical rollout fixture matrix", () => {
    const fixtures = [
      rolloutCurrentFixture,
      rolloutStaleFixture,
      rolloutPartialFixture,
      rolloutUnavailableFixture,
      rolloutBlockedFixture,
      rolloutCapacityFixture,
      rolloutIntegrityFixture,
      rolloutDeadLetterFixture,
      rolloutPausedFixture,
      rolloutTargetResolutionFixture,
    ];

    expect(fixtures).toHaveLength(10);
    expect(fixtures.every(({ statusVersion }) => statusVersion === 1)).toBe(
      true,
    );
  });

  it("binds the health route to the real rollout-status query", () => {
    const routeSource = readFileSync(
      new URL("../../routes/_workspace.health.tsx", import.meta.url),
      "utf8",
    );
    const surfaceSource = readFileSync(
      new URL("./health-surface.tsx", import.meta.url),
      "utf8",
    );

    expect(routeSource).toContain("HealthSurface");
    expect(routeSource).not.toContain("GoldenStatePage");
    expect(surfaceSource).toContain("brainReadApiRefs.brainRolloutStatus");
    expect(Ref.getConvexFunctionName(brainReadApiRefs.brainRolloutStatus)).toBe(
      "brain/readApi:brainRolloutStatus",
    );
  });

  it("uses backend promotion readiness as the authoritative primary gate", () => {
    const ready = buildBrainRolloutHealthBoardView(rolloutCurrentFixture);
    const blocked = buildBrainRolloutHealthBoardView(rolloutBlockedFixture);

    expect(ready.checks[0]).toEqual({
      label: "Promotion readiness",
      status: "ready",
      detail: "Backend reports this Brain is promotion-ready.",
    });
    expect(blocked.checks[0]).toMatchObject({
      label: "Promotion readiness",
      status: "blocked",
    });
    expect(ready.summary.blocked).toBe(0);
    expect(blocked.summary.blocked).toBeGreaterThan(0);
  });

  it.each([
    ["stale", rolloutStaleFixture, "Retrieval freshness", "degraded"],
    ["partial", rolloutPartialFixture, "Required coverage", "degraded"],
    ["unavailable", rolloutUnavailableFixture, "Required coverage", "blocked"],
  ] as const)(
    "presents %s backend status without upgrading readiness",
    (_name, fixture, label, status) => {
      const view = buildBrainRolloutHealthBoardView(fixture);

      expect(view.checks).toContainEqual(
        expect.objectContaining({ label, status }),
      );
      expect(view.checks[0]).toMatchObject({ status: "blocked" });
    },
  );

  it.each([
    [
      "capacity",
      rolloutCapacityFixture,
      "Retrieval or ingestion capacity was exceeded.",
    ],
    [
      "integrity",
      rolloutIntegrityFixture,
      "Publication integrity validation failed.",
    ],
    [
      "dead-letter",
      rolloutDeadLetterFixture,
      "Dead-letter publication jobs require repair.",
    ],
    ["paused", rolloutPausedFixture, "Ingestion workers are paused."],
    [
      "target resolution",
      rolloutTargetResolutionFixture,
      "Provider target-resolution intents remain unresolved.",
    ],
  ] as const)("surfaces %s blockers explicitly", (_name, fixture, copy) => {
    const view = buildBrainRolloutHealthBoardView(fixture);
    const scope = view.checks.find(({ label }) => label.startsWith("Slack"));

    expect(scope).toMatchObject({ status: "blocked" });
    expect(scope?.detail).toContain(copy);
  });

  it("distinguishes typed rollout capacity and integrity query failures", () => {
    expect(
      toBrainRolloutHealthBoardView({
        status: "typed_failure",
        error: { _tag: "RolloutStatusCapacityExceeded" },
      }),
    ).toMatchObject({
      state: "error",
      checks: [{ label: "Rollout status capacity", status: "blocked" }],
    });
    expect(
      toBrainRolloutHealthBoardView({
        status: "typed_failure",
        error: { _tag: "RolloutStatusIntegrityConflict" },
      }),
    ).toMatchObject({
      state: "error",
      checks: [{ label: "Rollout status integrity", status: "blocked" }],
    });
  });
});
