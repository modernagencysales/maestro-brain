import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireReviewAggregationSocketLease,
  releaseReviewAggregationSocketLease,
} from "../src/review-aggregation-lease.js";

const heldTokens = new Set<string>();

const acquire = async (key: string, recordedAuthority?: string) => {
  const lease = await acquireReviewAggregationSocketLease(
    key,
    recordedAuthority,
  );
  heldTokens.add(lease.token);
  return lease;
};

const release = async (token: string): Promise<void> => {
  await releaseReviewAggregationSocketLease(token);
  heldTokens.delete(token);
};

const childScript = [
  'import { acquireReviewAggregationSocketLease, releaseReviewAggregationSocketLease } from "./src/review-aggregation-lease.ts";',
  "try {",
  "  const lease = await acquireReviewAggregationSocketLease(process.argv[1], process.argv[2] === '-' ? undefined : process.argv[2]);",
  "  process.stdout.write(`won:${lease.authority}\\n`);",
  "  process.stdin.resume();",
  "  process.stdin.once('data', async () => { await releaseReviewAggregationSocketLease(lease.token); process.exit(0); });",
  "} catch (error) {",
  "  process.stdout.write(`lost:${String(error)}\\n`);",
  "  process.exit(0);",
  "}",
].join("\n");

const leaseChild = (key: string, authority?: string) =>
  spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      childScript,
      key,
      authority ?? "-",
    ],
    {
      cwd: new URL("..", import.meta.url),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

const firstLine = async (
  child: ReturnType<typeof leaseChild>,
): Promise<string> =>
  new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => {
      output += value;
      const newline = output.indexOf("\n");
      if (newline >= 0) resolve(output.slice(0, newline));
    });
    child.stderr.on("data", (value: string) => {
      errorOutput += value;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes("\n"))
        reject(new Error(`lease child failed (${code}): ${errorOutput}`));
    });
  });

const childExit = async (
  child: ReturnType<typeof leaseChild>,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode === "SIGKILL")
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGKILL") resolve();
      else reject(new Error(`lease child exited ${code ?? signal}`));
    });
  });
};

afterEach(async () => {
  await Promise.all([...heldTokens].map((token) => release(token)));
});

describe("review aggregation loopback lease", () => {
  it("rejects a duplicate while the exact recorded port is live", async () => {
    const key = `live-${randomUUID()}`;
    const owner = await acquire(key);

    expect(owner.authority).toMatch(/^127\.0\.0\.1:[1-9][0-9]*$/);
    await expect(
      acquireReviewAggregationSocketLease(key, owner.authority),
    ).rejects.toThrow("review aggregation socket lease is already held");
  });

  it("reclaims the exact recorded port after its child owner dies", async () => {
    const key = `dead-${randomUUID()}`;
    const child = leaseChild(key);
    const outcome = await firstLine(child);
    expect(outcome).toMatch(/^won:127\.0\.0\.1:[1-9][0-9]*$/);
    const authority = outcome.slice("won:".length);
    child.kill("SIGKILL");
    await childExit(child);

    const recovered = await acquire(key, authority);

    expect(recovered.authority).toBe(authority);
  });

  it("admits exactly one of two processes recovering one dead authority", async () => {
    const key = `race-${randomUUID()}`;
    const original = leaseChild(key);
    const initial = await firstLine(original);
    const authority = initial.slice("won:".length);
    original.kill("SIGKILL");
    await childExit(original);

    const contenders = [leaseChild(key, authority), leaseChild(key, authority)];
    try {
      const outcomes = await Promise.all(contenders.map(firstLine));
      expect(outcomes.filter((value) => value.startsWith("won:"))).toEqual([
        `won:${authority}`,
      ]);
      expect(
        outcomes.filter((value) =>
          value.includes("review aggregation socket lease is already held"),
        ),
      ).toHaveLength(1);
      const winner = outcomes.findIndex((value) => value.startsWith("won:"));
      contenders[winner]!.stdin.write("release\n");
      await childExit(contenders[winner]!);
    } finally {
      for (const child of contenders) child.kill("SIGKILL");
    }
  });

  it("releases only an active matching token and validates coordinates", async () => {
    await expect(acquireReviewAggregationSocketLease("")).rejects.toThrow(
      "review aggregation socket lease key is invalid",
    );
    for (const authority of [
      "localhost:1234",
      "127.0.0.1:0",
      "127.0.0.1:65536",
      "127.0.0.1:not-a-port",
    ])
      await expect(
        acquireReviewAggregationSocketLease("valid", authority),
      ).rejects.toThrow("review aggregation socket lease authority is invalid");

    const owner = await acquire(`token-${randomUUID()}`);
    await expect(
      releaseReviewAggregationSocketLease(randomUUID()),
    ).rejects.toThrow("review aggregation socket lease token is not active");
    await expect(
      acquireReviewAggregationSocketLease("duplicate", owner.authority),
    ).rejects.toThrow("review aggregation socket lease is already held");

    await release(owner.token);
    const replacement = await acquire("replacement", owner.authority);
    expect(replacement.authority).toBe(owner.authority);
  });
});
