import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyAggregate } from "./verify-aggregate.mjs";

const verifier = resolve("tooling/ci/verify-aggregate.mjs");
const commitSha = "15d2269f2b22e3a52e3a98c481b7d69cb7fef12f";
const repository = "modernagencysales/maestro-brain";

describe("Woodpecker verification aggregation", () => {
  it("uses the newest status for each required context", async () => {
    const fetchStatuses = async () =>
      new Response(
        JSON.stringify({
          statuses: [
            { context: "ci/woodpecker/pr/verify-core", state: "success" },
            { context: "ci/woodpecker/pr/verify-core", state: "failure" },
            {
              context: "ci/woodpecker/pr/verify-coverage",
              state: "success",
            },
            { context: null, state: "failure" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    await expect(
      verifyAggregate(
        repository,
        commitSha,
        fetchStatuses,
        "https://api.github.test",
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["an invalid repository", "missing-slash", commitSha],
    ["an invalid commit", repository, "short-sha"],
  ])("rejects %s before fetching", async (_label, repo, sha) => {
    await expect(verifyAggregate(repo, sha)).rejects.toThrow();
  });

  it("passes only when both required workflows succeeded", async () => {
    const result = await runVerifier(200, {
      statuses: [
        { context: "ci/woodpecker/pr/verify-core", state: "success" },
        { context: "ci/woodpecker/pr/verify-coverage", state: "success" },
      ],
    });

    expect(result).toEqual({ code: 0, stderr: "" });
  });

  it.each([
    [
      "a dependency failed",
      200,
      {
        statuses: [
          { context: "ci/woodpecker/pr/verify-core", state: "success" },
          { context: "ci/woodpecker/pr/verify-coverage", state: "failure" },
        ],
      },
    ],
    [
      "a dependency is missing",
      200,
      {
        statuses: [
          { context: "ci/woodpecker/pr/verify-core", state: "success" },
        ],
      },
    ],
    ["the API is unavailable", 503, { error: "unavailable" }],
  ] as const)("fails closed when %s", async (_label, status, body) => {
    const result = await runVerifier(status, body);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("verify-aggregate:");
  });
});

async function runVerifier(status: number, body: unknown) {
  const server = createServer((request, response) => {
    expect(request.url).toBe(
      `/repos/${repository}/commits/${commitSha}/status`,
    );
    expect(request.headers.accept).toBe("application/vnd.github+json");
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolveListen) => server.listen(0, resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("test server did not bind a TCP port");
  }

  try {
    const child = spawn(process.execPath, [verifier], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI_REPO: repository,
        CI_COMMIT_SHA: commitSha,
        GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const code = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    });
    return { code, stderr };
  } finally {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  }
}
