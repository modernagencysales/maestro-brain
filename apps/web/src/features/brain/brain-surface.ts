import type { Ref } from "@confect/core";
import type { TemplateConfectRefs } from "@maestro-template/convex/refs";
import type { BrainSource } from "@maestro-template/template-core";
import type {
  TemplateDataState,
  TemplateTypedFailureState,
} from "../../adapters/confect-state";

export type BrainContextPackPreview = {
  readonly title: string;
  readonly markdownSummary: string;
  readonly links: readonly string[];
  readonly evidenceSnapshots: readonly string[];
  readonly freshness: "fresh" | "mixed" | "review due";
  readonly ragPosture: "optional-not-default";
  readonly trustReceiptPosture: "required";
};

export type BrainSurfaceData = {
  readonly sources: readonly BrainSource[];
  readonly contextPack: BrainContextPackPreview;
};

export type BrainViewModel =
  | {
      readonly status: "ready";
      readonly sources: readonly BrainSource[];
      readonly contextPack: BrainContextPackPreview;
    }
  | BrainStateCopy;

export type BrainStateCopy = {
  readonly status:
    | "skipped"
    | "loading"
    | "empty"
    | "typed_failure"
    | "transport_failure"
    | "parse_failure"
    | "defect";
  readonly heading: string;
  readonly body: string;
};

export type BrainDocumentSection = {
  readonly heading: string;
  readonly body: readonly string[];
};

export function createBrainContextPackPreview(
  items: readonly string[],
): BrainContextPackPreview {
  return {
    title: "Approved source-backed context pack",
    markdownSummary:
      "Markdown, links, notes, evidence snapshots, freshness, policy exclusions, and review criteria are bundled into an agent-ready brief.",
    links: ["https://example.test/client-context"],
    evidenceSnapshots: items,
    freshness: items.length > 2 ? "mixed" : "fresh",
    ragPosture: "optional-not-default",
    trustReceiptPosture: "required",
  };
}

export function buildBrainViewModel(
  state: TemplateDataState<BrainSurfaceData | null, unknown>,
): BrainViewModel {
  if (state.status !== "ready") {
    return describeBrainState(state);
  }

  if (state.data === null) {
    return describeBrainState({ status: "empty", data: null });
  }

  return {
    status: "ready",
    sources: state.data.sources,
    contextPack: state.data.contextPack,
  };
}

export function buildBrainDocumentSections({
  sources,
  contextPack,
}: BrainSurfaceData): readonly BrainDocumentSection[] {
  return [
    {
      heading: "Why this matters",
      body: [
        "Most AI projects fail when the model has to guess what the company means. The Brain gives the app a source-grounded understanding of the client's market, language, offers, constraints, and proof.",
        "It can support RAG when a project truly needs retrieval, but RAG/vector search is optional and not the default truth model.",
        "The operating doctrine is simple: source content is data, not instructions; Trust Receipts carry the provenance.",
      ],
    },
    {
      heading: "What can go into it",
      body: sources.map(
        (source) =>
          `**${source.title}** becomes ${source.kind} context with ${source.evidence}. Freshness: ${source.freshness}.`,
      ),
    },
    {
      heading: "Context pack preview",
      body: [
        `**${contextPack.title}**: ${contextPack.markdownSummary}`,
        `Linked context: ${contextPack.links.join(", ")}.`,
        `Evidence snapshots: ${contextPack.evidenceSnapshots.join(", ")}.`,
        `Freshness posture: ${contextPack.freshness}.`,
        `RAG posture: ${contextPack.ragPosture}.`,
        `Trust Receipt posture: ${contextPack.trustReceiptPosture}.`,
      ],
    },
  ];
}

export function describeBrainState(
  state: Exclude<
    TemplateDataState<BrainSurfaceData | null, unknown>,
    { status: "ready" }
  >,
): BrainStateCopy {
  if (state.status === "skipped") {
    return {
      status: "skipped",
      heading: "Brain source request skipped",
      body: "No workspace context has been selected yet.",
    };
  }

  if (state.status === "loading") {
    return {
      status: "loading",
      heading: "Loading Brain sources",
      body: "The app is resolving approved markdown, links, notes, and evidence snapshots.",
    };
  }

  if (state.status === "empty") {
    return {
      status: "empty",
      heading: "No approved Brain sources yet",
      body: "Add markdown, links, or notes before asking agents to produce source-grounded output.",
    };
  }

  if (state.status === "typed_failure") {
    return typedFailureCopy(state);
  }

  if (state.status === "transport_failure") {
    return {
      status: "transport_failure",
      heading: "Brain sources are temporarily unavailable",
      body: state.message,
    };
  }

  if (state.status === "parse_failure") {
    return {
      status: "parse_failure",
      heading: "Brain source payload could not be decoded",
      body: state.message,
    };
  }

  return {
    status: "defect",
    heading: "Unexpected Brain surface defect",
    body: state.message,
  };
}

function typedFailureCopy(
  state: TemplateTypedFailureState<unknown>,
): BrainStateCopy {
  const error =
    typeof state.error === "object" && state.error !== null
      ? "_tag" in state.error
        ? String(state.error._tag)
        : "typed failure"
      : "typed failure";

  return {
    status: "typed_failure",
    heading: "Brain request was rejected by policy",
    body: `The backend returned ${error}.`,
  };
}

type PageListRef = TemplateConfectRefs["public"]["brain"]["pages"]["list"];
type PageGetRef = TemplateConfectRefs["public"]["brain"]["pages"]["get"];

export type BrainPageSummary = Ref.Returns<PageListRef>["pages"][number];
export type BrainPageDetail = Ref.Returns<PageGetRef>;
export type BrainWorkspaceRole = "viewer" | "editor" | "admin" | "owner";

export type BrainWorkspaceData = Ref.Returns<PageListRef> & {
  readonly selectedPage: BrainPageDetail | null;
  readonly role: BrainWorkspaceRole;
};

export type BrainWorkspaceFailure =
  | { readonly _tag: "Unauthorized" }
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "BrainNotFound" }
  | { readonly _tag: "PageNotFound"; readonly pageKey: string }
  | { readonly _tag: "LifecycleRevoked" }
  | { readonly _tag: "ValidationFailed" }
  | {
      readonly _tag: "StaleRevision";
      readonly pageKey: string;
      readonly expectedCurrentRevisionKey: string | null;
      readonly actualCurrentRevisionKey: string | null;
    }
  | { readonly _tag: string };

export type BrainEditorTarget = {
  readonly brainKey: string;
  readonly pageKey: string;
  readonly revisionKey: string;
  readonly documentId: `brainPage:${string}`;
  readonly snapshotVersion: number;
};

export type BrainPageTreeItem = {
  readonly pageKey: string;
  readonly parentPageKey: string | null;
  readonly title: string;
  readonly sortKey: string;
  readonly currentRevisionKey: string | null;
  readonly isFavorite: boolean;
  readonly isSelected: boolean;
};

export type BrainSelectedPage = {
  readonly pageKey: string;
  readonly title: string;
  readonly markdown: string;
  readonly updatedAt: number;
  readonly currentRevisionKey: string | null;
  readonly editorTarget: BrainEditorTarget | null;
};

export type BrainWorkspaceState =
  | {
      readonly status: "ready";
      readonly brainKey: string;
      readonly role: BrainWorkspaceRole;
      readonly canEdit: boolean;
      readonly asOf: number;
      readonly freshness: "current";
      readonly pages: readonly BrainPageTreeItem[];
      readonly selectedPage: BrainSelectedPage | null;
    }
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden" }
  | { readonly status: "stale_revision" }
  | { readonly status: "transport_failure" };

export const canEditBrain = (role: BrainWorkspaceRole): boolean =>
  role === "editor" || role === "admin" || role === "owner";

export function buildBrainWorkspaceState(
  state: TemplateDataState<BrainWorkspaceData | null, BrainWorkspaceFailure>,
): BrainWorkspaceState {
  if (state.status === "ready") {
    if (state.data === null) return { status: "empty" };
    const selectedPageKey = state.data.selectedPage?.page.pageKey ?? null;
    return {
      status: "ready",
      brainKey: state.data.brainKey,
      role: state.data.role,
      canEdit: canEditBrain(state.data.role),
      asOf: state.data.asOf,
      freshness: state.data.freshness.status,
      pages: state.data.pages
        .filter((page: BrainPageSummary) => page.status === "active")
        .sort((left: BrainPageSummary, right: BrainPageSummary) =>
          left.sortKey.localeCompare(right.sortKey),
        )
        .map((page: BrainPageSummary) => ({
          pageKey: page.pageKey,
          parentPageKey: page.parentPageKey,
          title: page.title,
          sortKey: page.sortKey,
          currentRevisionKey: page.currentRevisionKey,
          isFavorite: page.favorite,
          isSelected: page.pageKey === selectedPageKey,
        })),
      selectedPage: state.data.selectedPage
        ? toSelectedPage(state.data.brainKey, state.data.selectedPage)
        : null,
    };
  }
  if (state.status === "empty") return { status: "empty" };
  if (state.status === "loading" || state.status === "skipped") {
    return { status: "loading" };
  }
  if (state.status === "typed_failure") return typedFailureState(state.error);
  return { status: "transport_failure" };
}

export function toSelectedPage(
  brainKey: string,
  detail: BrainPageDetail,
): BrainSelectedPage {
  return {
    pageKey: detail.page.pageKey,
    title: detail.page.title,
    markdown: detail.markdown,
    updatedAt: detail.updatedAt,
    currentRevisionKey: detail.page.currentRevisionKey,
    editorTarget: toEditorTarget(brainKey, detail),
  };
}

export function toEditorTarget(
  brainKey: string,
  detail: BrainPageDetail,
): BrainEditorTarget | null {
  if (detail.page.currentRevisionKey === null) return null;
  return {
    brainKey,
    pageKey: detail.page.pageKey,
    revisionKey: detail.page.currentRevisionKey,
    documentId: `brainPage:${brainKey}:${detail.page.pageKey}`,
    snapshotVersion: detail.editorSnapshotVersion ?? 0,
  };
}

export function nextPageSortKey(
  pages: readonly Pick<BrainPageTreeItem, "sortKey">[],
): string {
  const max = Math.max(
    0,
    ...pages.map((page) => Number.parseInt(page.sortKey, 10) || 0),
  );
  return String(max + 1).padStart(10, "0");
}

export function describeBrainWorkspaceState(
  state: Exclude<BrainWorkspaceState, { readonly status: "ready" }>,
): string {
  switch (state.status) {
    case "loading":
      return "Loading Brain workspace.";
    case "empty":
      return "No pages in this Brain.";
    case "not_found":
      return "Brain page not found.";
    case "forbidden":
      return "Only authorized workspace members can open this Brain.";
    case "stale_revision":
      return "Newer revision available.";
    case "transport_failure":
      return "Brain workspace unavailable.";
  }
}

function typedFailureState(error: BrainWorkspaceFailure): BrainWorkspaceState {
  if (error._tag === "Forbidden" || error._tag === "Unauthorized") {
    return { status: "forbidden" };
  }
  if (error._tag === "StaleRevision") return { status: "stale_revision" };
  if (
    error._tag === "BrainNotFound" ||
    error._tag === "PageNotFound" ||
    error._tag === "LifecycleRevoked"
  ) {
    return { status: "not_found" };
  }
  return { status: "transport_failure" };
}
