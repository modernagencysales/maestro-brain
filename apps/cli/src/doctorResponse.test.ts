import { describe, expect, it } from "vitest";

import { failedDoctorCheckDetail } from "./doctorResponse";

describe("doctor response details", () => {
  it("surfaces a safe typed API credential failure", () => {
    expect(
      failedDoctorCheckDetail("Brain API", {
        value: {
          ok: false,
          error: { _tag: "Unauthorized", message: "Unauthorized." },
        },
        failure: "HTTP 401 response.",
      }),
    ).toBe("Brain API check failed: Unauthorized.");
  });
});
