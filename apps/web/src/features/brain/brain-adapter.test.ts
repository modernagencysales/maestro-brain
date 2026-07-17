import { describe, expect, it, vi } from "vitest";
import {
  buildBrainRouteArgs,
  brainRefs,
  saveBrainMarkdown,
} from "./brain-adapter";

describe("brain adapter", () => {
  it("exposes only generated Brain page refs through the feature adapter", () => {
    expect(brainRefs.pages).toHaveProperty("list");
    expect(brainRefs.pages).toHaveProperty("get");
    expect(brainRefs.pages).toHaveProperty("create");
    expect(brainRefs.pages).toHaveProperty("rename");
    expect(brainRefs.pages).toHaveProperty("move");
    expect(brainRefs.pages).toHaveProperty("favorite");
    expect(brainRefs.pages).toHaveProperty("archive");
  });

  it("skips queries until stable Brain and page keys are present", () => {
    expect(buildBrainRouteArgs({})).toEqual({
      listArgs: "skip",
      detailArgs: "skip",
    });
    expect(
      buildBrainRouteArgs({
        brainKey: "br_01HX0000000000000000000000",
        pageKey: "pg_overview",
      }),
    ).toEqual({
      listArgs: { brainKey: "br_01HX0000000000000000000000" },
      detailArgs: {
        brainKey: "br_01HX0000000000000000000000",
        pageKey: "pg_overview",
      },
    });
  });

  it("does not route existing-page markdown saves through create", async () => {
    const create = vi.fn().mockResolvedValue({ pageKey: "pg_overview" });

    await expect(
      saveBrainMarkdown(create, "# Overview"),
    ).resolves.toMatchObject({
      status: "ready",
    });
    expect(create).not.toHaveBeenCalled();
  });
});
