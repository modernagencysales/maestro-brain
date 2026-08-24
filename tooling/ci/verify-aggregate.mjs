#!/usr/bin/env node

import console from "node:console";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const requiredContexts = [
  "ci/woodpecker/pr/verify-core",
  "ci/woodpecker/pr/verify-coverage",
];

export async function verifyAggregate(
  repository = process.env.CI_REPO,
  commitSha = process.env.CI_COMMIT_SHA,
  fetchStatuses = globalThis.fetch,
  githubApiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com",
) {
  const endpoint = statusEndpoint(repository, commitSha, githubApiUrl);
  const response = await fetchStatuses(endpoint, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "maestro-template-verify-aggregate",
    },
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub status API returned HTTP ${response.status}`);
  }

  const combinedStatus = await response.json();
  if (!Array.isArray(combinedStatus?.statuses)) {
    throw new Error("GitHub status API response omitted statuses");
  }

  // GitHub returns newest statuses first. Keep the first state for each context
  // so a retried workflow cannot be shadowed by an older result.
  const states = new Map();
  for (const status of combinedStatus.statuses) {
    if (typeof status?.context === "string" && !states.has(status.context)) {
      states.set(status.context, status.state);
    }
  }
  const unsuccessful = requiredContexts.filter(
    (context) => states.get(context) !== "success",
  );
  if (unsuccessful.length > 0) {
    throw new Error(
      unsuccessful
        .map((context) => `${context}=${states.get(context) ?? "missing"}`)
        .join(", "),
    );
  }

  console.log("verify-aggregate: required workflows succeeded");
}

function statusEndpoint(repository, commitSha, githubApiUrl) {
  if (!/^[^/]+\/[^/]+$/u.test(repository ?? "")) {
    throw new Error("CI_REPO must be owner/name");
  }
  if (!/^[a-f\d]{40}$/iu.test(commitSha ?? "")) {
    throw new Error("CI_COMMIT_SHA must be a full Git OID");
  }
  const url = new URL(githubApiUrl);
  url.pathname = `/repos/${repository}/commits/${commitSha}/status`;
  url.search = "";
  url.hash = "";
  return url;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await verifyAggregate();
  } catch (error) {
    console.error(`verify-aggregate: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  }
}
