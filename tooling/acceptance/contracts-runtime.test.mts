import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSeedAttemptTimeout,
  readLocalAdminKeyForPort,
  runLocalSeedMutation,
} from "../../tests/acceptance/support/runtime";

const temporaryRoots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("contracts runtime seed retries", () => {
  it.each([
    [120_000, 120_000, 15_000, 15_000],
    [10_000, 120_000, 15_000, 10_000],
    [120_000, 5_000, 15_000, 5_000],
    [0, 120_000, 15_000, 1],
  ])(
    "bounds one seed attempt without consuming the overall deadline",
    (remaining, command, attempt, expected) => {
      expect(boundedSeedAttemptTimeout(remaining, command, attempt)).toBe(
        expected,
      );
    },
  );
});

describe("local Convex credential selection", () => {
  it("selects the deployment that owns the exact cloud port", async () => {
    const root = await mkdtemp(join(tmpdir(), "contracts-local-convex-"));
    temporaryRoots.push(root);
    for (const [name, cloud, adminKey] of [
      ["other", 31_000, "other-admin-key"],
      ["acceptance", 32_000, "acceptance-admin-key"],
    ] as const) {
      const directory = join(root, ".convex", "local", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "config.json"),
        JSON.stringify({ adminKey, ports: { cloud, site: cloud + 1 } }),
      );
    }

    await expect(readLocalAdminKeyForPort(root, 32_000)).resolves.toBe(
      "acceptance-admin-key",
    );
  });

  it("fails closed when no deployment owns the requested port", async () => {
    const root = await mkdtemp(join(tmpdir(), "contracts-local-convex-"));
    temporaryRoots.push(root);
    const directory = join(root, ".convex", "local", "default");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({ adminKey: "not-for-this-port", ports: { cloud: 1 } }),
    );

    await expect(readLocalAdminKeyForPort(root, 2)).rejects.toThrow(
      "matched cloud port 2",
    );
  });
});

describe("local Convex seed transport", () => {
  it("calls the owned backend directly with admin auth", async () => {
    let observedAuthorization = "";
    let observedBody = "";
    let observedUrl = "";
    const server = createServer((request, response) => {
      observedUrl = request.url ?? "";
      observedAuthorization = request.headers.authorization ?? "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        observedBody = `${observedBody}${chunk}`;
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "success",
            value: { primary: { keyId: "primary" }, observer: {} },
          }),
        );
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Fixture server did not bind a TCP port.");
    const output = await runLocalSeedMutation({
      deploymentUrl: `http://127.0.0.1:${address.port}`,
      adminKey: "local-admin-key",
      args: {
        namespace: "contracts-fixture",
        primaryKeyHash: "a".repeat(43),
        observerKeyHash: "b".repeat(43),
      },
      timeoutMs: 1_000,
    });

    expect(observedAuthorization).toBe("Convex local-admin-key");
    expect(observedUrl).toBe("/api/function");
    expect(JSON.parse(observedBody)).toMatchObject({
      path: "headless/apiKeys:seedLocalContracts",
      args: { namespace: "contracts-fixture" },
    });
    expect(JSON.parse(output)).toMatchObject({
      primary: { keyId: "primary" },
    });
  });

  it("aborts a seed request at its per-attempt deadline", async () => {
    let requestClosed = false;
    const server = createServer((request) => {
      request.on("close", () => {
        requestClosed = true;
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Fixture server did not bind a TCP port.");
    await expect(
      runLocalSeedMutation({
        deploymentUrl: `http://127.0.0.1:${address.port}`,
        adminKey: "local-admin-key",
        args: {
          namespace: "contracts-fixture",
          primaryKeyHash: "a".repeat(43),
          observerKeyHash: "b".repeat(43),
        },
        timeoutMs: 5,
      }),
    ).rejects.toThrow("seed mutation timed out");
    await expect.poll(() => requestClosed).toBe(true);
  });
});
