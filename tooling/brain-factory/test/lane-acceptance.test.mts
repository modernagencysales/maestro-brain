import { describe, expect, it } from "vitest";

import { validateLaneAcceptance } from "../src/lane-acceptance.js";

describe("lane acceptance records", () => {
  it("requires explicit blocker evidence for integrated tasks", () => {
    expect(() =>
      validateLaneAcceptance({ status: "integrated" }, "S00-T02"),
    ).toThrow(/migrate and re-prove legacy records/);
    expect(() =>
      validateLaneAcceptance(
        {
          acceptanceBlocker: "S00-T01 three-host receipt is unavailable",
          accepted: false,
          status: "integrated",
        },
        "S00-T02",
      ),
    ).not.toThrow();
  });

  it("rejects contradictory accepted records", () => {
    expect(() =>
      validateLaneAcceptance(
        {
          accepted: true,
          acceptanceBlocker: "still blocked",
          status: "accepted",
        },
        "S00-T02",
      ),
    ).toThrow(/retains an acceptanceBlocker/);
  });
});
