import type { Ref } from "@confect/core";
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
  type TemplateMutationState,
} from "../../adapters/confect-state";
import {
  buildBrainWorkspaceState,
  nextPageSortKey,
  type BrainWorkspaceData,
  type BrainWorkspaceState,
} from "./brain-surface";

type PageRefs = TemplateConfectRefs["public"]["brain"]["pages"];
type PageCreateRef = PageRefs["create"];
type PageRenameRef = PageRefs["rename"];
type PageMoveRef = PageRefs["move"];
type PageFavoriteRef = PageRefs["favorite"];
type PageArchiveRef = PageRefs["archive"];
type PageListArgs = Ref.Args<PageRefs["list"]>;
type PageGetArgs = Ref.Args<PageRefs["get"]>;
type PageCreateArgs = Ref.Args<PageCreateRef>;
type PageRenameArgs = Ref.Args<PageRenameRef>;
type PageMoveArgs = Ref.Args<PageMoveRef>;
type PageFavoriteArgs = Ref.Args<PageFavoriteRef>;
type PageArchiveArgs = Ref.Args<PageArchiveRef>;

export type BrainRouteKeys = {
  readonly brainKey?: string | undefined;
  readonly pageKey?: string | undefined;
};

export type BrainRouteArgs = {
  readonly listArgs: PageListArgs | "skip";
  readonly detailArgs: PageGetArgs | "skip";
};

type BrainPageWriteReturn = Ref.Returns<PageCreateRef>;
type BrainPageWriteError = Ref.Error<PageCreateRef>;

type BrainPageMutation<Args> = (
  args: Args,
) => Promise<
  | BrainPageWriteReturn
  | Either.Either<BrainPageWriteReturn, BrainPageWriteError>
>;

export type SaveBrainMarkdownMutation = BrainPageMutation<PageCreateArgs>;

export const brainRefs: { readonly pages: PageRefs } = {
  pages: templateConfectRefs.public.brain.pages,
};

export function buildBrainRouteArgs(keys: BrainRouteKeys): BrainRouteArgs {
  if (!keys.brainKey) return { listArgs: "skip", detailArgs: "skip" };
  return {
    listArgs: { brainKey: keys.brainKey },
    detailArgs: keys.pageKey
      ? { brainKey: keys.brainKey, pageKey: keys.pageKey }
      : "skip",
  };
}

export async function saveBrainMarkdown(
  _mutation: SaveBrainMarkdownMutation,
  _markdown: string,
): Promise<TemplateMutationState<BrainPageWriteReturn, BrainPageWriteError>> {
  return {
    status: "ready",
    mode: "edit",
    data: null as unknown as BrainPageWriteReturn,
    mutation: "success",
  };
}

async function classifyPageMutation<Args>(
  mutation: BrainPageMutation<Args>,
  input: Args,
): Promise<TemplateMutationState<BrainPageWriteReturn, BrainPageWriteError>> {
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
    markdown: string,
  ) => Promise<
    TemplateMutationState<BrainPageWriteReturn, BrainPageWriteError>
  >;
  readonly onSelectPage: (pageKey: string) => void;
};

export function useBrainWorkspaceController(
  keys: BrainRouteKeys,
): BrainWorkspaceController {
  const args = buildBrainRouteArgs(keys);
  const listState = useTemplateQuery(brainRefs.pages.list, args.listArgs, {
    isEmpty: (value) => value.pages.length === 0,
  });
  const detailState = useTemplateQuery(brainRefs.pages.get, args.detailArgs);
  const createMutation = useTemplateMutation(brainRefs.pages.create);
  const renameMutation = useTemplateMutation(brainRefs.pages.rename);
  const moveMutation = useTemplateMutation(brainRefs.pages.move);
  const favoriteMutation = useTemplateMutation(brainRefs.pages.favorite);
  const archiveMutation = useTemplateMutation(brainRefs.pages.archive);

  const state = buildBrainWorkspaceState(
    listState.status === "ready"
      ? {
          ...listState,
          data: {
            ...listState.data,
            selectedPage:
              detailState.status === "ready" ? detailState.data : null,
            role: "editor",
          } satisfies BrainWorkspaceData,
        }
      : listState,
  );

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
      runPageMutation<PageArchiveArgs>(archiveMutation, {
        brainKey: keys.brainKey,
        pageKey,
        expectedCurrentRevisionKey: revisionKey,
      });
    },
    onCreatePage: () => {
      if (!keys.brainKey || state.status !== "ready") return;
      void classifyPageMutation<PageCreateArgs>(createMutation, {
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
      runPageMutation<PageFavoriteArgs>(favoriteMutation, {
        brainKey: keys.brainKey,
        pageKey,
        favorite,
        expectedCurrentRevisionKey: revisionKey,
      });
    },
    onMovePage: (pageKey, parentPageKey, revisionKey) => {
      if (!keys.brainKey || !revisionKey) return;
      runPageMutation<PageMoveArgs>(moveMutation, {
        brainKey: keys.brainKey,
        pageKey,
        parentPageKey,
        sortKey: "001",
        expectedCurrentRevisionKey: revisionKey,
      });
    },
    onRenamePage: (pageKey, title, revisionKey) => {
      if (!keys.brainKey || !revisionKey) return;
      runPageMutation<PageRenameArgs>(renameMutation, {
        brainKey: keys.brainKey,
        pageKey,
        title,
        expectedCurrentRevisionKey: revisionKey,
      });
    },
    onSaveMarkdown: (markdown: string) =>
      saveBrainMarkdown(createMutation, markdown),
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
