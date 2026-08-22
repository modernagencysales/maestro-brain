import { describe, expect, it } from "vitest";

import runtimeSchema from "../confect/_generated/convexSchema";
import typedSchema from "../confect/_generated/schema";

describe("Confect and Convex schema parity", () => {
  it("deploys every table exposed to typed backend code", () => {
    const typedTables = Object.keys(typedSchema.tables).sort();
    const runtimeTables = Object.keys(runtimeSchema.tables).sort();

    expect(runtimeTables).toEqual(typedTables);
  });
});
