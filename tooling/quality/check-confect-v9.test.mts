import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { collectConfectV9Findings } from "./check-confect-v9.mts";

const writeJson = async (
  repoRoot: string,
  file: string,
  packageJson: Record<string, unknown>,
) => {
  await mkdir(join(repoRoot, file, ".."), { recursive: true });
  await writeFile(join(repoRoot, file), JSON.stringify(packageJson, null, 2));
};

const writeSource = async (repoRoot: string, file: string, source: string) => {
  await mkdir(join(repoRoot, file, ".."), { recursive: true });
  await writeFile(join(repoRoot, file), source);
};

const makeRepo = async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "confect-v9-"));
  await writeJson(repoRoot, "packages/convex/package.json", {
    dependencies: {
      "@confect/core": "9.1.5",
      "@confect/server": "9.1.5",
      "@confect/test": "9.1.5",
    },
  });
  await writeJson(repoRoot, "apps/web/package.json", {
    dependencies: { "@confect/react": "9.1.5" },
  });
  await writeJson(repoRoot, "apps/cli/package.json", {
    dependencies: { "@confect/js": "9.1.5" },
  });
  await writeJson(repoRoot, "tooling/effectified-api-proof/package.json", {
    dependencies: {
      "@confect/core": "9.1.5",
      "@confect/server": "9.1.5",
      "@confect/test": "9.1.5",
    },
    devDependencies: { "@confect/cli": "9.1.5" },
  });
  await writeSource(
    repoRoot,
    "packages/convex/confect/tables/pages.ts",
    `import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() => Schema.Struct({ title: Schema.String }));
`,
  );
  await writeSource(
    repoRoot,
    "packages/convex/confect/brain/pages.spec.ts",
    `import { FunctionSpec, GroupSpec } from "@confect/server";
import * as Schema from "effect/Schema";

export default GroupSpec.make().addFunction("list", FunctionSpec.publicQuery({
  args: () => Schema.Struct({}),
  returns: () => Schema.Array(Schema.String),
  error: () => Schema.Never,
}));
`,
  );
  await writeSource(
    repoRoot,
    "packages/convex/confect/brain/pages.impl.ts",
    `import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import databaseSchema from "../_generated/schema";
import spec from "./pages.spec";

const list = FunctionImpl.make(databaseSchema, spec.list, () => Effect.succeed([]));

export default GroupImpl.finalize(GroupImpl.make(databaseSchema, spec).addFunction("list", list));
`,
  );
  return repoRoot;
};

describe("check:confect-v9", () => {
  it("accepts a minimal Confect v9 fixture", async () => {
    const repoRoot = await makeRepo();

    expect(collectConfectV9Findings(repoRoot)).toEqual([]);
  });

  it("reports package and source-shape violations", async () => {
    const repoRoot = await makeRepo();
    await writeJson(repoRoot, "apps/web/package.json", {
      dependencies: { "@confect/react": "9.1.4" },
    });
    await writeSource(repoRoot, "packages/convex/confect/spec.ts", "");
    await writeSource(
      repoRoot,
      "packages/convex/confect/brain/pages.spec.ts",
      `import { FunctionSpec, GroupSpec } from "@confect/server";
import { Schema } from "effect";

export default GroupSpec.make("brain").addFunction("list", FunctionSpec.publicQuery({
  args: Schema.Struct({}),
  returns: Schema.Array(Schema.String),
}));
`,
    );
    await writeSource(
      repoRoot,
      "packages/convex/confect/brain/pages.impl.ts",
      `import { FunctionImpl, GroupImpl } from "@confect/server";
import api from "../_generated/api";
import spec from "./pages.spec";

const list = FunctionImpl.make(api, spec.list, () => null);

export default GroupImpl.make(api, spec).addFunction("list", list);
`,
    );
    await writeSource(
      repoRoot,
      "packages/convex/confect/tables/pages.ts",
      `import { Table } from "@confect/server";

export default Table.make("pages", () => ({}));
`,
    );

    expect(collectConfectV9Findings(repoRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "package.json",
          message: expect.stringContaining(
            "All @confect/* packages must share one exact v9 patch",
          ),
        }),
        expect.objectContaining({
          file: "packages/convex/confect/spec.ts",
          message: expect.stringContaining("root aggregate"),
        }),
        expect.objectContaining({
          file: "packages/convex/confect/brain/pages.spec.ts",
          message: expect.stringContaining("effect barrel"),
        }),
        expect.objectContaining({
          file: "packages/convex/confect/brain/pages.spec.ts",
          message: expect.stringContaining("GroupSpec.make"),
        }),
        expect.objectContaining({
          file: "packages/convex/confect/brain/pages.spec.ts",
          message: expect.stringContaining("args schema"),
        }),
        expect.objectContaining({
          file: "packages/convex/confect/brain/pages.impl.ts",
          message: expect.stringContaining("generated databaseSchema"),
        }),
        expect.objectContaining({
          file: "packages/convex/confect/brain/pages.impl.ts",
          message: expect.stringContaining("GroupImpl.finalize"),
        }),
        expect.objectContaining({
          file: "packages/convex/confect/tables/pages.ts",
          message: expect.stringContaining("Table.make(() =>"),
        }),
      ]),
    );
  });
});
