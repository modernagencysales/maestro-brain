import type { Ref } from "@confect/core";
import { makeFunctionReference } from "convex/server";
import { useEffect } from "react";
import type * as Either from "effect/Either";
import {
  templateConfectRefs,
  type TemplateConfectRefs,
} from "@maestro-template/convex/refs";
import {
  classifyConfectMutationResult,
  normalizeMutationError,
  useTemplateMutation,
  useTemplateQuery,
  type TemplateDataState,
  type TemplateMutationState,
} from "../../adapters/confect-state";
import {
  buildBrainWorkspaceState,
  nextPageSortKey,
  type BrainWorkspaceData,
  type BrainWorkspaceFailure,
  type BrainPageSummary,
  type BrainWorkspaceRole,
  type BrainWorkspaceState,
} from "./brain-surface";
import { useWorkspace } from "../../providers/workspace";
import type { BlockNoteSyncEditorProps } from "@maestro-template/editor-react/client";
import type { BrainMarkdownSaveArgs } from "./brain-workspace";

type PageRefs = TemplateConfectRefs["public"]["brain"]["pages"];
type EditorSyncRefs = BlockNoteSyncEditorProps["api"];
type PageListArgs = Ref.Args<PageRefs["list"]>;
type PageGetArgs = Ref.Args<PageRefs["get"]>;
type PageListState = TemplateDataState<
  Ref.Returns<PageRefs["list"]>,
  BrainWorkspaceFailure
>;
type PageDetailState = TemplateDataState<
  Ref.Returns<PageRefs["get"]>,
  BrainWorkspaceFailure
>;

export type BrainRouteKeys = {
  readonly brainKey?: string | undefined;
  readonly pageKey?: string | undefined;
};

export type BrainRouteArgs = {
  readonly listArgs: PageListArgs | "skip";
  readonly detailArgs: PageGetArgs | "skip";
};

type EditorSnapshotRef = PageRefs["recordSnapshot"];
type BrainPageWriteReturn = Ref.Returns<PageRefs["create"]>;
type BrainPageWriteError = Ref.Error<PageRefs["create"]>;
type BrainSnapshotWriteReturn = Ref.Returns<EditorSnapshotRef>;
type BrainSnapshotWriteError = Ref.Error<EditorSnapshotRef>;

type BrainPageMutation<
  Args,
  Returns = BrainPageWriteReturn,
  Error = BrainPageWriteError,
> = (args: Args) => Promise<Returns | Either.Either<Returns, Error>>;

export type SaveBrainMarkdownMutation = BrainPageMutation<
  BrainMarkdownSaveArgs,
  BrainSnapshotWriteReturn,
  BrainSnapshotWriteError
>;
export const brainRefs: TemplateConfectRefs["public"]["brain"] =
  templateConfectRefs.public.brain;

export const buildWorkspaceSyncApi = (): EditorSyncRefs => ({
  getSnapshot: makeFunctionReference("editorSync:getSnapshot"),
  submitSnapshot: makeFunctionReference("editorSync:submitSnapshot"),
  latestVersion: makeFunctionReference("editorSync:latestVersion"),
  getSteps: makeFunctionReference("editorSync:getSteps"),
  submitSteps: makeFunctionReference("editorSync:submitSteps"),
});

export function buildBrainRouteArgs(keys: BrainRouteKeys): BrainRouteArgs {
  if (!keys.brainKey) return { listArgs: "skip", detailArgs: "skip" };
  return {
    listArgs: { brainKey: keys.brainKey },
    detailArgs: keys.pageKey
      ? { brainKey: keys.brainKey, pageKey: keys.pageKey }
      : "skip",
  };
}

export function buildBrainWorkspaceControllerState(
  listState: PageListState,
  detailState: PageDetailState,
  role: BrainWorkspaceRole,
): BrainWorkspaceState {
  if (listState.status === "loading" || listState.status === "skipped") {
    return { status: "loading" };
  }
  if (listState.status === "empty") return { status: "empty" };
  if (listState.status === "typed_failure") {
    return buildBrainWorkspaceState({
      status: "typed_failure",
      error: listState.error,
    });
  }
  if (listState.status !== "ready") return { status: "transport_failure" };

  if (detailState.status === "loading" || detailState.status === "skipped") {
    return { status: "loading" };
  }
  if (detailState.status === "empty") return { status: "not_found" };
  if (detailState.status === "typed_failure") {
    return buildBrainWorkspaceState({
      status: "typed_failure",
      error: detailState.error,
    });
  }
  if (
    detailState.status === "transport_failure" ||
    detailState.status === "parse_failure" ||
    detailState.status === "defect"
  ) {
    return { status: "transport_failure" };
  }

  return buildBrainWorkspaceState({
    ...listState,
    data: {
      ...listState.data,
      selectedPage: detailState.status === "ready" ? detailState.data : null,
      role,
    } satisfies BrainWorkspaceData,
  });
}

export async function saveBrainMarkdown(
  mutation: SaveBrainMarkdownMutation,
  args: BrainMarkdownSaveArgs | null,
): Promise<
  TemplateMutationState<
    BrainSnapshotWriteReturn,
    BrainSnapshotWriteError | BrainWorkspaceFailure
  >
> {
  if (args === null) {
    return {
      status: "typed_failure",
      error: { _tag: "ValidationFailed" },
    };
  }

  return classifyPageMutation(mutation, args);
}

async function classifyPageMutation<
  Args,
  Returns = BrainPageWriteReturn,
  Error = BrainPageWriteError,
>(
  mutation: BrainPageMutation<Args, Returns, Error>,
  input: Args,
): Promise<TemplateMutationState<Returns, Error>> {
  try {
    return classifyConfectMutationResult(await mutation(input), {
      mode: "edit",
    });
  } catch (error) {
    return normalizeMutationError(error);
  }
}

export type BrainWorkspaceController = {
  readonly state: BrainWorkspaceState;
  readonly onArchivePage: (pageKey: string, revisionKey: string | null) => void;
  readonly onCreatePage: () => void;
  readonly onFavoritePage: (
    pageKey: string,
    favorite: boolean,
    revisionKey: string | null,
  ) => void;
  readonly onMovePage: (
    pageKey: string,
    parentPageKey: string | null,
    revisionKey: string | null,
  ) => void;
  readonly onRenamePage: (
    pageKey: string,
    title: string,
    revisionKey: string | null,
  ) => void;
  readonly onSaveMarkdown: (
    args: BrainMarkdownSaveArgs | null,
  ) => Promise<
    TemplateMutationState<
      BrainSnapshotWriteReturn,
      BrainSnapshotWriteError | BrainWorkspaceFailure
    >
  >;
  readonly onSelectPage: (pageKey: string) => void;
  readonly syncApi: EditorSyncRefs;
};

export function useBrainWorkspaceController(
  keys: BrainRouteKeys,
): BrainWorkspaceController {
  const args = buildBrainRouteArgs(keys);
  const workspace = useWorkspace();
  const role: BrainWorkspaceRole =
    workspace.status === "ready" ? workspace.activeWorkspace.role : "viewer";
  const listState = useTemplateQuery(brainRefs.pages.list, args.listArgs, {
    isEmpty: (value) => value.pages.length === 0,
  });
  const detailState = useTemplateQuery(brainRefs.pages.get, args.detailArgs);
  const createMutation = useTemplateMutation(brainRefs.pages.create);
  const saveMutation = useTemplateMutation(brainRefs.pages.recordSnapshot);
  const renameMutation = useTemplateMutation(brainRefs.pages.rename);
  const moveMutation = useTemplateMutation(brainRefs.pages.move);
  const favoriteMutation = useTemplateMutation(brainRefs.pages.favorite);
  const archiveMutation = useTemplateMutation(brainRefs.pages.archive);

  const state = buildBrainWorkspaceControllerState(
    listState,
    detailState,
    role,
  );

  useEffect(() => {
    if (keys.pageKey || listState.status !== "ready") return;
    const firstActivePage = listState.data.pages
      .filter((page: BrainPageSummary) => page.status === "active")
      .sort((left: BrainPageSummary, right: BrainPageSummary) =>
        left.sortKey.localeCompare(right.sortKey),
      )[0];
    if (!keys.brainKey || firstActivePage === undefined) return;
    window.history.replaceState(
      null,
      "",
      `/brain?brainKey=${encodeURIComponent(keys.brainKey)}&pageKey=${encodeURIComponent(firstActivePage.pageKey)}`,
    );
  }, [keys.brainKey, keys.pageKey, listState]);

  const runPageMutation = <Args>(
    mutation: BrainPageMutation<Args>,
    input: Args,
  ): void => {
    void classifyPageMutation(mutation, input);
  };

  return {
    state,
    onArchivePage: (pageKey, revisionKey) => {
      if (!keys.brainKey || !revisionKey) return;
      runPageMutation<Ref.Args<PageRefs["archive"]>>(archiveMutation, {
        brainKey: keys.brainKey,
        pageKey,
        expectedCurrentRevisionKey: revisionKey,
      });
    },
    onCreatePage: () => {
      if (!keys.brainKey || state.status !== "ready") return;
      void classifyPageMutation<Ref.Args<PageRefs["create"]>>(createMutation, {
        brainKey: keys.brainKey,
        parentPageKey: null,
        siblingSlug: "untitled-page",
        sortKey: nextPageSortKey(state.pages),
        title: "Untitled page",
        markdown: "",
        expectedCurrentRevisionKey: null,
      });
    },
    onFavoritePage: (pageKey, favorite, revisionKey) => {
      if (!keys.brainKey || !revisionKey) return;
      runPageMutation<Ref.Args<PageRefs["favorite"]>>(favoriteMutation, {
        brainKey: keys.brainKey,
        pageKey,
        favorite,
        expectedCurrentRevisionKey: revisionKey,
      });
    },
    onMovePage: (pageKey, parentPageKey, revisionKey) => {
      if (!keys.brainKey || !revisionKey || state.status !== "ready") return;
      runPageMutation<Ref.Args<PageRefs["move"]>>(moveMutation, {
        brainKey: keys.brainKey,
        pageKey,
        parentPageKey,
        sortKey: nextPageSortKey(state.pages),
        expectedCurrentRevisionKey: revisionKey,
      });
    },
    onRenamePage: (pageKey, title, revisionKey) => {
      if (!keys.brainKey || !revisionKey) return;
      runPageMutation<Ref.Args<PageRefs["rename"]>>(renameMutation, {
        brainKey: keys.brainKey,
        pageKey,
        title,
        expectedCurrentRevisionKey: revisionKey,
      });
    },
    onSaveMarkdown: (args) => saveBrainMarkdown(saveMutation, args),
    syncApi: buildWorkspaceSyncApi(),
    onSelectPage: (pageKey) => {
      if (!keys.brainKey || pageKey === keys.pageKey) return;
      window.history.pushState(
        null,
        "",
        `/brain?brainKey=${encodeURIComponent(keys.brainKey)}&pageKey=${encodeURIComponent(pageKey)}`,
      );
    },
  };
}
