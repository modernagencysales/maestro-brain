import { describe, expect, it } from "vitest";
import { planDeployCommand } from "./guardedDeploy.js";

describe("guarded deployment command planning", () => {
  it("routes Convex through the pinned workspace CLI", () => {
    expect(
      planDeployCommand({
        action: "convex",
        commitSha: "a".repeat(40),
        env: {},
      }),
    ).toEqual({
      executable: "pnpm",
      args: ["--dir", "packages/convex", "exec", "convex", "deploy", "-y"],
    });
  });

  it("routes Worker deployments through the checked-in pinned Wrangler", () => {
    const commitSha = "b".repeat(40);

    expect(
      planDeployCommand({
        action: "cloudflare",
        commitSha,
        env: { CLOUDFLARE_DEPLOYMENT_KIND: "worker" },
      }),
    ).toEqual({
      executable: "pnpm",
      args: [
        "--dir",
        "apps/web",
        "exec",
        "wrangler",
        "deploy",
        "--keep-vars",
        "--message",
        `maestro-brain ${commitSha}`,
        "--tag",
        commitSha.slice(0, 8),
      ],
    });
  });

  it("retains the reviewed Pages path for separately configured environments", () => {
    expect(
      planDeployCommand({
        action: "cloudflare",
        commitSha: "c".repeat(40),
        env: {
          CLOUDFLARE_DEPLOYMENT_KIND: "pages",
          CLOUDFLARE_PAGES_PROJECT: "maestro-template",
          CLOUDFLARE_PAGES_BRANCH: "main",
        },
      }),
    ).toEqual({
      executable: "pnpm",
      args: [
        "dlx",
        "wrangler@latest",
        "pages",
        "deploy",
        "apps/web/dist/client",
        "--project-name",
        "maestro-template",
        "--branch",
        "main",
        "--commit-dirty=true",
      ],
    });
  });

  it("fails closed without an explicit Cloudflare deployment kind", () => {
    expect(() =>
      planDeployCommand({
        action: "cloudflare",
        commitSha: "d".repeat(40),
        env: {},
      }),
    ).toThrow("CLOUDFLARE_DEPLOYMENT_KIND");
  });
});
