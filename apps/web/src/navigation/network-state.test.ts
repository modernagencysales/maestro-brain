import { describe, expect, it } from "vitest";
import {
  networkStateFromNavigator,
  readBrowserNetworkState,
} from "./network-state";

describe("browser network state", () => {
  it("treats missing browser network APIs as online for SSR", () => {
    expect(networkStateFromNavigator(undefined)).toBe("online");
    expect(readBrowserNetworkState()).toBe("online");
  });

  it("maps navigator online flags to route network banner states", () => {
    expect(networkStateFromNavigator({ onLine: true })).toBe("online");
    expect(networkStateFromNavigator({ onLine: false })).toBe("offline");
    expect(networkStateFromNavigator({})).toBe("online");
  });
});
