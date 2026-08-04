import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  buildContractManifest,
  buildContractJsonSchemas,
  duplicateOperationIds,
  manifestOperationIds,
  mergeContractSchemaRegistries,
  missingSchemasForManifest,
} from "./index";

describe("confect manifest tooling", () => {
  it("compiles generated descriptors without admitting unrelated JSON", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const probeDirectory = join(
      root,
      "packages/convex/confect/capabilities",
      `manifest-json-probe-${process.pid}-${Date.now()}`,
    );
    const descriptor = join(probeDirectory, "probe.headless.json");
    const unrelated = join(probeDirectory, "unrelated.json");

    mkdirSync(probeDirectory, { recursive: true });
    try {
      writeFileSync(descriptor, '{"capability":"probe"}\n');
      writeFileSync(unrelated, '{"unrelated":true}\n');
      writeFileSync(
        // Keep the compiler probe out of Vitest's Convex test discovery. The
        // manifest tsconfig includes all generated .ts files, so a test suffix
        // is unnecessary and races with the parallel Convex test project.
        join(probeDirectory, "probe.ts"),
        'import metadata from "./probe.headless.json";\nexport const capability = metadata.capability;\n',
      );

      const result = spawnSync(
        process.execPath,
        [
          resolve(root, "node_modules/typescript/bin/tsc"),
          "-p",
          resolve(root, "tooling/confect-manifest/tsconfig.json"),
          "--noEmit",
          "--pretty",
          "false",
          "--listFiles",
        ],
        { cwd: root, encoding: "utf8", timeout: 25_000 },
      );
      const output = `${result.stdout}${result.stderr}`;
      const listedProbeFiles = output
        .split(/\r?\n/u)
        .filter((line) => line.startsWith(probeDirectory));

      expect(result.status, output).toBe(0);
      expect(listedProbeFiles).toContain(descriptor);
      expect(listedProbeFiles).not.toContain(unrelated);
    } finally {
      rmSync(probeDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it("sorts operation ids for deterministic output", () => {
    const manifest = buildContractManifest([
      {
        namespace: "b",
        name: "run",
        operationId: "b.run",
        kind: "mutation",
        surfaces: ["api"],
        typedErrors: ["Unauthorized"],
        idempotent: false,
        argsSchemaName: "b.run.args",
        returnsSchemaName: "b.run.returns",
      },
      {
        namespace: "a",
        name: "list",
        operationId: "a.list",
        kind: "query",
        surfaces: ["web"],
        typedErrors: ["WorkspaceNotFound"],
        idempotent: true,
        argsSchemaName: "a.list.args",
        returnsSchemaName: "a.list.returns",
      },
    ]);

    expect(manifestOperationIds(manifest)).toEqual(["a.list", "b.run"]);
  });

  it("finds duplicate operation ids once in sorted order", () => {
    expect(
      duplicateOperationIds([
        {
          namespace: "b",
          name: "run",
          operationId: "b.run",
          kind: "mutation",
          surfaces: ["api"],
          typedErrors: [],
          idempotent: false,
          argsSchemaName: "b.run.args",
          returnsSchemaName: "b.run.returns",
        },
        {
          namespace: "a",
          name: "list",
          operationId: "a.list",
          kind: "query",
          surfaces: ["web"],
          typedErrors: [],
          idempotent: true,
          argsSchemaName: "a.list.args",
          returnsSchemaName: "a.list.returns",
        },
        {
          namespace: "b",
          name: "runAgain",
          operationId: "b.run",
          kind: "action",
          surfaces: ["workflow"],
          typedErrors: [],
          idempotent: false,
          argsSchemaName: "b.runAgain.args",
          returnsSchemaName: "b.runAgain.returns",
        },
        {
          namespace: "a",
          name: "listAgain",
          operationId: "a.list",
          kind: "query",
          surfaces: ["web"],
          typedErrors: [],
          idempotent: true,
          argsSchemaName: "a.listAgain.args",
          returnsSchemaName: "a.listAgain.returns",
        },
      ]),
    ).toEqual(["a.list", "b.run"]);
  });

  it("merges schema registries with later registries taking precedence", () => {
    expect(
      mergeContractSchemaRegistries(
        { shared: Schema.String, "a.args": Schema.String },
        { shared: Schema.Number, "b.returns": Schema.Boolean },
      ),
    ).toEqual({
      shared: Schema.Number,
      "a.args": Schema.String,
      "b.returns": Schema.Boolean,
    });
  });

  it("reports missing manifest schemas in deterministic order", () => {
    const manifest = buildContractManifest([
      {
        namespace: "b",
        name: "run",
        operationId: "b.run",
        kind: "mutation",
        surfaces: ["api"],
        typedErrors: [],
        idempotent: false,
        argsSchemaName: "b.run.args",
        returnsSchemaName: "b.run.returns",
      },
      {
        namespace: "a",
        name: "list",
        operationId: "a.list",
        kind: "query",
        surfaces: ["web"],
        typedErrors: [],
        idempotent: true,
        argsSchemaName: "a.list.args",
        returnsSchemaName: "a.list.returns",
      },
    ]);

    expect(
      missingSchemasForManifest(manifest, {
        "b.run.args": Schema.String,
      }),
    ).toEqual(["a.list.args", "a.list.returns", "b.run.returns"]);
  });

  it("builds Effect JSON schemas for OpenAPI and MCP targets", () => {
    expect(
      buildContractJsonSchemas({
        "a.run.args": Schema.Struct({
          workspaceId: Schema.String,
          title: Schema.String,
        }),
        "a.run.returns": Schema.Struct({
          ok: Schema.Literal(true),
        }),
      }),
    ).toMatchObject({
      openApi31: {
        "a.run.args": {
          type: "object",
          required: ["workspaceId", "title"],
          properties: {
            workspaceId: { type: "string" },
            title: { type: "string" },
          },
        },
      },
      mcp: {
        "a.run.returns": {
          type: "object",
          required: ["ok"],
          properties: {
            ok: { type: "boolean", enum: [true] },
          },
        },
      },
    });
  });
});
