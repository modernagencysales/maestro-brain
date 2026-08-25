import { describe, expect, it } from "vitest";

import { isLogoutRequest, logoutRedirect } from "#lib/auth/workos-logout";

describe("WorkOS logout route", () => {
  it("accepts only same-origin POST logout requests", () => {
    expect(
      isLogoutRequest(
        new Request("https://app.example/api/auth/logout", {
          method: "POST",
          headers: { Origin: "https://app.example" },
        }),
      ),
    ).toBe(true);
    expect(
      isLogoutRequest(new Request("https://app.example/api/auth/session")),
    ).toBe(false);
    expect(
      isLogoutRequest(new Request("https://app.example/api/auth/logout")),
    ).toBe(false);
    expect(
      isLogoutRequest(
        new Request("https://app.example/api/auth/logout", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
  });

  it("uses See Other so the WorkOS logout redirect follows with GET", () => {
    const headers = new Headers({
      Location:
        "https://api.workos.com/user_management/sessions/logout?session_id=session_1",
    });
    const response = logoutRedirect(headers);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toContain(
      "/user_management/sessions/logout",
    );
  });
});
