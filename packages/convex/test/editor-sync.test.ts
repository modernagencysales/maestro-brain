import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import type { DataModel } from "../convex/_generated/dataModel";
import { parseEditorTarget } from "../confect/editor/documentTargets";
import { recordEditorSnapshot } from "../confect/editor/syncApi";
import { requireEditorDocumentAccess } from "../confect/editor/sync";
import {
  getSnapshot,
  getSteps,
  latestVersion,
  submitSnapshot,
  submitSteps,
} from "../convex/editorSync";

type TestCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

type IndexCall = {
  readonly table: string;
  readonly index: string;
  readonly eqs: ReadonlyArray<readonly [string, unknown]>;
};

const makeIndexQuery = (table: string, doc: unknown, calls: IndexCall[]) => ({
  withIndex: vi.fn((index: string, build: (q: QueryEq) => QueryEq) => {
    const eqs: Array<readonly [string, unknown]> = [];
    const q: QueryEq = {
      eq: vi.fn((field: string, value: unknown) => {
        eqs.push([field, value]);
        return q;
      }),
    };
    build(q);
    calls.push({ table, index, eqs });
    const docs = Array.isArray(doc) ? doc : doc === null ? [] : [doc];
    return {
      collect: vi.fn(async () => docs),
      unique: vi.fn(async () => doc),
    };
  }),
});

type QueryEq = {
  readonly eq: (field: string, value: unknown) => QueryEq;
};

const makeAuthCtx = ({
  identity = { subject: "subject_1" },
  user = { _id: "user_1", status: "active" },
  page = { _id: "page_1", workspaceId: "workspace_1" },
  workspace = {
    _id: "workspace_1",
    id: "workspace_1",
    organizationId: "organization_1",
    status: "active",
  },
  organization = {
    _id: "organization_1",
    id: "organization_1",
    status: "active",
  },
  member = {
    workspaceId: "workspace_1",
    userId: "user_1",
    status: "active",
    role: "editor",
    acceptedAt: 1,
    revokedAt: null,
    deletedAt: null,
  },
  organizationMember = null,
}: {
  readonly identity?: { readonly subject: string } | null;
  readonly user?: unknown;
  readonly page?: unknown;
  readonly workspace?: unknown;
  readonly organization?: unknown;
  readonly member?: unknown;
  readonly organizationMember?: unknown;
} = {}) => {
  const indexCalls: IndexCall[] = [];
  const ctx = {
    auth: {
      getUserIdentity: vi.fn(async () => identity),
    },
    db: {
      normalizeId: vi.fn((_table: string, id: string) => id),
      get: vi.fn(async (id: string) => {
        if (id === "page_1") return page;
        if (id === "workspace_1") return workspace;
        if (id === "organization_1") return organization;
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "users") return makeIndexQuery(table, user, indexCalls);
        if (table === "workspaceMembers") {
          return makeIndexQuery(
            table,
            member === null ? [] : [member],
            indexCalls,
          );
        }
        if (table === "organizationMembers") {
          return makeIndexQuery(
            table,
            organizationMember === null ? [] : [organizationMember],
            indexCalls,
          );
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    },
  } satisfies Record<string, unknown>;
  return { ctx: ctx as unknown as TestCtx, indexCalls };
};

describe("editor sync registration", () => {
  it("parses only supported editor document targets", () => {
    expect(parseEditorTarget("brainPage:page_1")).toEqual({
      kind: "brainPage",
      id: "page_1",
    });
    expect(() => parseEditorTarget("document_1")).toThrow(
      "Unsupported editor document target",
    );
    expect(() => parseEditorTarget("document:document_1")).toThrow(
      "Unsupported editor document target",
    );
  });

  it("exports the five sync API functions", () => {
    expect(typeof getSnapshot).toBe("function");
    expect(typeof submitSnapshot).toBe("function");
    expect(typeof latestVersion).toBe("function");
    expect(typeof getSteps).toBe("function");
    expect(typeof submitSteps).toBe("function");
  });

  it("rejects unauthenticated access", async () => {
    const { ctx } = makeAuthCtx({ identity: null });

    await expect(
      requireEditorDocumentAccess(ctx, "brainPage:page_1", "viewer"),
    ).rejects.toMatchObject({
      data: {
        _tag: "EditorSyncAccessDenied",
        reason: "authentication",
      },
    });
    await expect(
      requireEditorDocumentAccess(ctx, "brainPage:page_1", "viewer"),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects unsupported document targets with tagged ConvexError data", async () => {
    const { ctx } = makeAuthCtx();

    await expect(
      requireEditorDocumentAccess(ctx, "document_1", "viewer"),
    ).rejects.toMatchObject({
      data: {
        _tag: "EditorSyncAccessDenied",
        reason: "unsupported-target",
      },
    });
  });

  it("resolves user and workspace membership before allowing editor writes", async () => {
    const { ctx, indexCalls } = makeAuthCtx();

    await expect(
      requireEditorDocumentAccess(ctx, "brainPage:page_1", "editor"),
    ).resolves.toBeUndefined();

    expect(indexCalls).toEqual([
      {
        table: "users",
        index: "by_subject",
        eqs: [["subject", "subject_1"]],
      },
      {
        table: "workspaceMembers",
        index: "by_workspace_user",
        eqs: [
          ["workspaceId", "workspace_1"],
          ["userId", "user_1"],
        ],
      },
      {
        table: "organizationMembers",
        index: "by_organization_user",
        eqs: [
          ["organizationId", "organization_1"],
          ["userId", "user_1"],
        ],
      },
    ]);
  });

  it("rejects inactive users", async () => {
    const { ctx } = makeAuthCtx({
      user: { _id: "user_1", status: "suspended" },
    });

    await expect(
      requireEditorDocumentAccess(ctx, "brainPage:page_1", "viewer"),
    ).rejects.toMatchObject({
      data: {
        _tag: "EditorSyncAccessDenied",
        reason: "active-user",
      },
    });
  });

  it("rejects lifecycle-invalid direct workspace memberships", async () => {
    for (const member of [
      {
        workspaceId: "workspace_1",
        userId: "user_1",
        status: "pending",
        role: "editor",
        acceptedAt: null,
        revokedAt: null,
        deletedAt: null,
      },
      {
        workspaceId: "workspace_1",
        userId: "user_1",
        status: "active",
        role: "editor",
        acceptedAt: 1,
        revokedAt: 2,
        deletedAt: null,
      },
      {
        workspaceId: "workspace_1",
        userId: "user_1",
        status: "active",
        role: "editor",
        acceptedAt: 1,
        revokedAt: null,
        deletedAt: 3,
      },
    ]) {
      const { ctx } = makeAuthCtx({ member });

      await expect(
        requireEditorDocumentAccess(ctx, "brainPage:page_1", "viewer"),
      ).rejects.toMatchObject({
        data: {
          _tag: "EditorSyncAccessDenied",
          reason: "workspace-membership",
        },
      });
    }
  });

  it("rejects archived workspaces and inactive organizations", async () => {
    await expect(
      requireEditorDocumentAccess(
        makeAuthCtx({
          workspace: {
            _id: "workspace_1",
            id: "workspace_1",
            organizationId: "organization_1",
            status: "archived",
          },
        }).ctx,
        "brainPage:page_1",
        "viewer",
      ),
    ).rejects.toThrow("workspace membership");

    await expect(
      requireEditorDocumentAccess(
        makeAuthCtx({
          organization: {
            _id: "organization_1",
            id: "organization_1",
            status: "suspended",
          },
        }).ctx,
        "brainPage:page_1",
        "viewer",
      ),
    ).rejects.toThrow("workspace membership");
  });

  it("records Brain page snapshots through the internal mirror mutation", async () => {
    const runMutation = vi.fn<(_ref: unknown, _args: unknown) => Promise<null>>(
      async () => null,
    );
    const ctx = {
      db: {
        normalizeId: vi.fn(() => "page_1"),
        get: vi.fn(async () => ({
          _id: "page_1",
          workspaceId: "workspace_1",
        })),
      },
      runMutation,
    } as unknown as GenericMutationCtx<DataModel>;

    await recordEditorSnapshot(ctx, "brainPage:page_1", '{"type":"doc"}', 42);

    expect(runMutation).toHaveBeenCalledTimes(1);
    const firstCall = runMutation.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[1]).toEqual({
      workspaceId: "workspace_1",
      pageId: "page_1",
      snapshot: '{"type":"doc"}',
      version: 42,
    });
  });
});
