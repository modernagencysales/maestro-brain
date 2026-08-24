import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  requestDurableDeployAuthorization,
  type DeployAuthorityAction,
} from "./durableAuthority.js";

export interface DeployCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export function planDeployCommand(input: {
  readonly action: DeployAuthorityAction;
  readonly commitSha: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): DeployCommand {
  if (input.action === "convex") {
    return {
      executable: "pnpm",
      args: ["--dir", "packages/convex", "exec", "convex", "deploy", "-y"],
    };
  }

  const deploymentKind = input.env.CLOUDFLARE_DEPLOYMENT_KIND;
  if (deploymentKind === "worker") {
    return {
      executable: "pnpm",
      args: [
        "--dir",
        "apps/web",
        "exec",
        "wrangler",
        "deploy",
        "--keep-vars",
        "--message",
        `maestro-brain ${input.commitSha}`,
        "--tag",
        input.commitSha.slice(0, 8),
      ],
    };
  }

  if (deploymentKind === "pages") {
    return {
      executable: "pnpm",
      args: [
        "dlx",
        "wrangler@latest",
        "pages",
        "deploy",
        "apps/web/dist/client",
        "--project-name",
        input.env.CLOUDFLARE_PAGES_PROJECT ?? "maestro-template",
        "--branch",
        input.env.CLOUDFLARE_PAGES_BRANCH ?? "main",
        "--commit-dirty=true",
      ],
    };
  }

  throw new Error(
    "CLOUDFLARE_DEPLOYMENT_KIND must be explicitly set to worker or pages.",
  );
}

async function main(): Promise<void> {
  const [action] = process.argv.slice(2) as [DeployAuthorityAction | undefined];
  const environment = process.env.DEPLOY_ENVIRONMENT;
  const commitSha = process.env.CI_COMMIT_SHA;
  const targetId = process.env.PROMOTION_TARGET_ID;
  if (
    (action !== "convex" && action !== "cloudflare") ||
    (environment !== "staging" && environment !== "production") ||
    !commitSha ||
    !targetId
  ) {
    throw new Error(
      "Guarded deploy requires action and exact environment, commit, and target scope.",
    );
  }
  const publicKeyPem = readFileSync(
    resolve(
      process.cwd(),
      "tooling/release/keys/deploy-authority-public-key.pem",
    ),
    "utf8",
  );
  await requestDurableDeployAuthorization(
    { environment, commitSha, targetId, action },
    {
      endpoint: process.env.PROMOTION_AUTHORITY_ENDPOINT,
      publicKeyPem,
      nowMs: Date.now,
      fetch,
    },
  );
  const command = planDeployCommand({ action, commitSha, env: process.env });
  const result = spawnSync(command.executable, command.args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0)
    throw new Error(`Guarded ${action} deployment failed.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
