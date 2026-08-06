import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it, vi } from "vitest";

import type { DataModel } from "../convex/_generated/dataModel";
import { parseEditorTarget } from "../confect/editor/documentTargets";
import {
  recordCurrentEditorSnapshot,
  recordEditorSnapshot,
} from "../confect/editor/syncApi";

describe("Brain editor revision fences", () => {
  it("parses opaque stable Brain page document targets", () => {
    expect(
      parseEditorTarget(
        "brainPage:br_0123456789ABCDEFGHJKMNPQRS:pag_editor_fence",
      ),
    ).toEqual({
      kind: "brainPage",
      brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
      pageKey: "pag_editor_fence",
      legacyPageId: null,
    });
  });

  it("parses a stable target with an edit-start revision fence", () => {
    expect(
      parseEditorTarget(
        "brainPage:br_0123456789ABCDEFGHJKMNPQRS:pag_editor_fence:rev_current",
      ),
    ).toMatchObject({
      brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
      pageKey: "pag_editor_fence",
      expectedCurrentRevisionKey: "rev_current",
    });
  });

  it("forwards stable page targets with their expected revision fence", async () => {
    const runMutation = vi.fn<
      (_ref: unknown, _args: unknown) => Promise<unknown>
    >(async () => ({
      pageKey: "pag_editor_fence",
      pageRevisionKey: "rev_next",
      contentHash: "hash_next",
      savedAt: 123,
    }));
    const ctx = {
      db: {
        normalizeId: vi.fn(() => null),
        get: vi.fn(),
        query: vi.fn(),
      },
      runMutation,
    } as unknown as GenericMutationCtx<DataModel>;

    await expect(
      recordEditorSnapshot(
        ctx,
        "brainPage:br_0123456789ABCDEFGHJKMNPQRS:pag_editor_fence",
        '{"type":"doc"}',
        10,
        "rev_current",
      ),
    ).resolves.toEqual({
      pageKey: "pag_editor_fence",
      pageRevisionKey: "rev_next",
      contentHash: "hash_next",
      savedAt: 123,
    });

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
      pageKey: "pag_editor_fence",
      expectedCurrentRevisionKey: "rev_current",
      snapshot: '{"type":"doc"}',
      version: 10,
    });
  });

  it("binds the live stable snapshot callback to the current revision fence", async () => {
    const runMutation = vi.fn<
      (_ref: unknown, _args: unknown) => Promise<unknown>
    >(async () => ({
      pageKey: "pag_editor_fence",
      pageRevisionKey: "rev_next",
      contentHash: "hash_next",
      savedAt: 123,
    }));
    const page = {
      _id: "page_1",
      workspaceId: "workspace_1",
      pageKey: "pag_editor_fence",
      currentRevisionKey: "rev_current",
      status: "active",
      lifecycle: { state: "active" },
    };
    const workspace = {
      _id: "workspace_1",
      brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
    };
    const ctx = {
      db: {
        normalizeId: vi.fn(() => null),
        get: vi.fn(),
        query: vi.fn((table: string) => {
          if (table === "workspaces") {
            return { collect: vi.fn(async () => [workspace]) };
          }
          if (table === "brainPages") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn(async () => page) })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      },
      runMutation,
    } as unknown as GenericMutationCtx<DataModel>;

    await expect(
      recordCurrentEditorSnapshot(
        ctx,
        "brainPage:br_0123456789ABCDEFGHJKMNPQRS:pag_editor_fence:rev_current",
        '{"type":"doc"}',
        12,
      ),
    ).resolves.toEqual({
      pageKey: "pag_editor_fence",
      pageRevisionKey: "rev_next",
      contentHash: "hash_next",
      savedAt: 123,
    });

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
      pageKey: "pag_editor_fence",
      expectedCurrentRevisionKey: "rev_current",
      snapshot: '{"type":"doc"}',
      version: 12,
    });
  });

  it("drops a debounced snapshot after the page revision has advanced", async () => {
    const runMutation = vi.fn(async () => null);
    const page = {
      _id: "page_1",
      workspaceId: "workspace_1",
      pageKey: "pag_editor_fence",
      currentRevisionKey: "rev_newer",
      status: "active",
      lifecycle: { state: "active" },
    };
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "workspaces") {
            return {
              collect: vi.fn(async () => [
                {
                  _id: "workspace_1",
                  brainKey: "br_0123456789ABCDEFGHJKMNPQRS",
                },
              ]),
            };
          }
          return {
            withIndex: vi.fn(() => ({ unique: vi.fn(async () => page) })),
          };
        }),
      },
      runMutation,
    } as unknown as GenericMutationCtx<DataModel>;

    await expect(
      recordCurrentEditorSnapshot(
        ctx,
        "brainPage:br_0123456789ABCDEFGHJKMNPQRS:pag_editor_fence:rev_current",
        '{"type":"doc"}',
        12,
      ),
    ).resolves.toBeNull();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("refuses the live callback when the document has no edit-start fence", async () => {
    const runMutation = vi.fn(async () => null);
    const ctx = {
      db: { query: vi.fn(), normalizeId: vi.fn(), get: vi.fn() },
      runMutation,
    } as unknown as GenericMutationCtx<DataModel>;
    await expect(
      recordCurrentEditorSnapshot(
        ctx,
        "brainPage:br_0123456789ABCDEFGHJKMNPQRS:pag_editor_fence",
        '{"type":"doc"}',
        12,
      ),
    ).resolves.toBeNull();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("does not publish a stable editor snapshot without an explicit revision fence", async () => {
    const runMutation = vi.fn<
      (_ref: unknown, _args: unknown) => Promise<unknown>
    >(async () => null);
    const ctx = {
      db: {
        normalizeId: vi.fn(() => null),
        get: vi.fn(),
        query: vi.fn(),
      },
      runMutation,
    } as unknown as GenericMutationCtx<DataModel>;

    await expect(
      recordEditorSnapshot(
        ctx,
        "brainPage:br_0123456789ABCDEFGHJKMNPQRS:pag_editor_fence",
        '{"type":"doc"}',
        11,
      ),
    ).resolves.toBeNull();

    expect(runMutation).not.toHaveBeenCalled();
  });
});
