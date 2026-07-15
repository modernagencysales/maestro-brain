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

  it("rejects positive acceptance evidence on an integrated task", () => {
    expect(() =>
      validateLaneAcceptance(
        {
          accepted: false,
          acceptanceBlocker: "acceptance still needs independent proof",
          acceptedBecause: "the prerequisite is present",
          status: "integrated",
        },
        "S08-T02",
      ),
    ).toThrow(/retains acceptedBecause despite accepted:false/);
    expect(() =>
      validateLaneAcceptance(
        {
          accepted: false,
          acceptanceBlocker: "acceptance still needs independent proof",
          acceptedBecause: "",
          status: "integrated",
        },
        "S08-T02",
      ),
    ).toThrow(/retains acceptedBecause despite accepted:false/);
  });
});
