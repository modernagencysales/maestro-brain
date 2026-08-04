import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Convex Node runtime boundaries", () => {
  it("keeps Nango-backed Slack delivery in a use-node action module", () => {
    const outbox = readFileSync(
      new URL("../convex/slack/outbox.ts", import.meta.url),
      "utf8",
    );
    const worker = readFileSync(
      new URL("../convex/slack/outboxWorker.ts", import.meta.url),
      "utf8",
    );

    expect(outbox).not.toContain("@maestro-template/integrations/nango/client");
    expect(worker.startsWith('"use node";')).toBe(true);
    expect(worker).toContain("@maestro-template/integrations/nango/client");
  });

  it("keeps Nango-backed Slack connect actions in a use-node module", () => {
    const implementation = readFileSync(
      new URL(
        "../confect/integrations/slackConnections.impl.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const actions = readFileSync(
      new URL(
        "../confect/integrations/slackConnections.node.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(implementation).not.toContain(
      "@maestro-template/integrations/nango/client",
    );
    expect(actions.startsWith('"use node";')).toBe(true);
    expect(actions).toContain("api.nango.dev");
  });
});
