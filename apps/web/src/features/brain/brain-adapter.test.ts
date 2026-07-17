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

  it("routes existing-page markdown saves through row-id fenced editor sync args", async () => {
    const save = vi.fn().mockResolvedValue({ pageKey: "pg_overview" });
    const args = {
      id: "brainPage:j97f0k4knmzsk2a4tx9c6a4r497msf7s",
      version: 1,
      content: "# Overview",
    };

    await expect(saveBrainMarkdown(save, args)).resolves.toMatchObject({
      status: "ready",
      mutation: "success",
    });
    expect(save).toHaveBeenCalledWith(args);
  });

  it("does not fabricate success when save args cannot be built", async () => {
    const save = vi.fn();

    await expect(saveBrainMarkdown(save, null)).resolves.toMatchObject({
      status: "typed_failure",
      error: { _tag: "ValidationFailed" },
    });
    expect(save).not.toHaveBeenCalled();
  });
});
