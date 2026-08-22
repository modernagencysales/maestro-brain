import type { BrainSource } from "@maestro-template/template-core";
import type { Ref } from "@confect/core";
import * as Either from "effect/Either";
import {
  templateConfectRefs,
  type TemplateConfectRefs,
} from "@maestro-template/convex/refs";
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

type BrainPageRefs = TemplateConfectRefs["public"]["brain"]["pages"];
type BrainPilotRefs = TemplateConfectRefs["public"]["brain"]["pilot"];
type BrainReadApiRefs = TemplateConfectRefs["public"]["brain"]["readApi"];
type BrainCallReviewRefs = TemplateConfectRefs["public"]["brain"]["callReview"];
export type BrainPageSummary = {
  readonly pageKey: string;
  readonly parentPageKey: string | null;
  readonly siblingSlug: string;
  readonly sortKey: string;
  readonly title: string;
  readonly favorite: boolean;
  readonly status: "active" | "archived" | "redacted" | "purged";
  readonly currentRevisionKey: string | null;
  readonly lifecycleGeneration: number;
};
export type BrainPageListData = {
  readonly brainKey: string;
  readonly asOf: number;
  readonly freshness: { readonly status: "current" };
  readonly pages: readonly BrainPageSummary[];
};
export type BrainPageDetail = {
  readonly page: BrainPageSummary;
  readonly markdown: string;
  readonly editorSnapshotJson?: string;
  readonly editorSnapshotVersion?: number;
  readonly updatedAt: number;
};
export type BrainFreshness = "current" | "stale" | "unknown";
export type BrainCoverage = {
  readonly corpusKey: string;
  readonly sourceKind: string;
  readonly connectorScopeKey: string;
  readonly required: boolean;
  readonly status: "complete" | "partial" | "unavailable" | "unknown";
  readonly freshness: BrainFreshness;
  readonly generations?: {
    readonly connection?: number;
    readonly allowlist?: number;
    readonly policy?: number;
    readonly reconciliation?: number;
  };
  readonly lastSuccessfulAt?: number;
  readonly lastObservedAt?: number;
  readonly lastReconciledAt?: number;
  readonly unresolvedFailureCount: number;
  readonly reason?: string;
};
export type BrainOmission = {
  readonly reason: string;
  readonly count: number;
};
export type BrainSearchResult = {
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly publicationSetKey: string;
  readonly entryKey: string;
  readonly passageKey: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly contentHash: string;
  readonly kind: "source" | "page" | "projection";
  readonly unitKey?: string;
  readonly segmentKey?: string;
  readonly citationKey: string;
  readonly title: string;
  readonly excerpt: string;
  readonly locator?: string;
  readonly citationLabel?: string;
  readonly permalink?: string;
  readonly authority: "authoritative" | "derived" | "advisory";
  readonly authorityPolicyKey: string;
  readonly sourceModifiedAt?: number;
  readonly observedAt: number;
  readonly indexedAt: number;
  readonly freshness: BrainFreshness;
  readonly truncated: boolean;
  readonly state: "resolved";
};
export type BrainSourcesSearchData = {
  readonly brainKey: string;
  readonly results: readonly BrainSearchResult[];
  readonly coverage: readonly BrainCoverage[];
  readonly omissions: readonly BrainOmission[];
};
export type BrainSourceGetData = BrainSearchResult & {
  readonly brainKey: string;
  readonly revisionKey: string;
  readonly status: string;
};
export type BrainContextPackData = {
  readonly schemaVersion: "1";
  readonly candidateManifest: {
    readonly version: "1";
    readonly hash: string;
  };
  readonly requestId: string;
  readonly organizationKey: string;
  readonly brainKey: string;
  readonly question: string;
  readonly asOf: number;
  readonly freshness?: { readonly status: BrainFreshness };
  readonly coverage: readonly BrainCoverage[];
  readonly entries: readonly BrainSearchResult[];
  readonly omissions: readonly BrainOmission[];
  readonly conflicts: readonly {
    readonly subject: string;
    readonly revisionKeys: readonly string[];
    readonly reason?: string;
  }[];
};

type BrainReadFailureState =
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "integrity_failure"; readonly message: string }
  | { readonly status: "capacity_failure"; readonly message: string };
export type BrainSearchState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly query: string }
  | { readonly status: "empty"; readonly query: string }
  | {
      readonly status: "ready" | "partial" | "stale";
      readonly query: string;
      readonly results: readonly BrainSearchResult[];
      readonly coverage: readonly BrainCoverage[];
      readonly omissions: readonly BrainOmission[];
    }
  | (BrainReadFailureState & { readonly query: string });
export type BrainContextState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "empty" | "ready" | "partial" | "stale";
      readonly data: BrainContextPackData;
    }
  | BrainReadFailureState;
export type BrainSourceState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready" | "stale";
      readonly data: BrainSourceGetData;
    }
  | BrainReadFailureState;
export type BrainReviewQueueData = {
  readonly brainKey: string;
  readonly items: readonly {
    readonly sourceKey: string;
    readonly title: string;
    readonly submittedAt: number;
    readonly status: "pending_review" | "published" | "rejected";
    readonly route: "direct" | "classify" | "capture-only" | null;
  }[];
};
export type BrainCallMaintenanceQueueData = Ref.Returns<
  BrainCallReviewRefs["listCallMaintenanceQueue"]
>;
export type BrainPageUpdateData = BrainPageSummary;
export type BrainRevisionHistoryData = {
  readonly brainKey: string;
  readonly pageKey: string;
  readonly asOf: number;
  readonly freshness: { readonly status: "current" };
  readonly revisions: readonly {
    readonly revisionKey: string;
    readonly priorRevisionKey: string | null;
    readonly causation: string;
    readonly createdAt: number;
    readonly lifecycleGeneration: number;
    readonly markdown?: string;
    readonly contentHash?: string;
    readonly state?: string;
    readonly actorKind?: string;
    readonly actorId?: string;
  }[];
};

type BrainWorkspaceRefs = {
  readonly list: BrainPageRefs["list"];
  readonly get: BrainPageRefs["get"];
  readonly create: BrainPageRefs["create"];
  readonly rename: BrainPageRefs["rename"];
  readonly favorite: BrainPageRefs["favorite"];
  readonly archive: BrainPageRefs["archive"];
  readonly move: BrainPageRefs["move"];
  readonly restore: BrainPageRefs["restore"];
  readonly history: BrainPageRefs["history"];
};

type BrainWorkspacePilotRefs = {
  readonly submitNote: BrainPilotRefs["submitNote"];
  readonly reviewNote: BrainPilotRefs["reviewNote"];
  readonly listReviewQueue: BrainPilotRefs["listReviewQueue"];
  readonly updatePage: BrainPilotRefs["updatePage"];
};
type BrainWorkspaceReadApiRefs = {
  readonly sourcesSearch: BrainReadApiRefs["sourcesSearch"];
  readonly sourcesGet: BrainReadApiRefs["sourcesGet"];
  readonly contextGet: BrainReadApiRefs["contextGet"];
};
type BrainWorkspaceCallReviewRefs = {
  readonly listCallMaintenanceQueue: BrainCallReviewRefs["listCallMaintenanceQueue"];
  readonly reviewCallMaintenance: BrainCallReviewRefs["reviewCallMaintenance"];
};

export const brainWorkspaceRefs: BrainWorkspaceRefs = {
  list: templateConfectRefs.public.brain.pages.list,
  get: templateConfectRefs.public.brain.pages.get,
  create: templateConfectRefs.public.brain.pages.create,
  rename: templateConfectRefs.public.brain.pages.rename,
  favorite: templateConfectRefs.public.brain.pages.favorite,
  archive: templateConfectRefs.public.brain.pages.archive,
  move: templateConfectRefs.public.brain.pages.move,
  restore: templateConfectRefs.public.brain.pages.restore,
  history: templateConfectRefs.public.brain.pages.history,
} as const;

export const brainPilotRefs: BrainWorkspacePilotRefs = {
  submitNote: templateConfectRefs.public.brain.pilot.submitNote,
  reviewNote: templateConfectRefs.public.brain.pilot.reviewNote,
  listReviewQueue: templateConfectRefs.public.brain.pilot.listReviewQueue,
  updatePage: templateConfectRefs.public.brain.pilot.updatePage,
} as const;

export const brainReadApiRefs: BrainWorkspaceReadApiRefs = {
  sourcesSearch: templateConfectRefs.public.brain.readApi.sourcesSearch,
  sourcesGet: templateConfectRefs.public.brain.readApi.sourcesGet,
  contextGet: templateConfectRefs.public.brain.readApi.contextGet,
} as const;

export const brainCallReviewRefs: BrainWorkspaceCallReviewRefs = {
  listCallMaintenanceQueue:
    templateConfectRefs.public.brain.callReview.listCallMaintenanceQueue,
  reviewCallMaintenance:
    templateConfectRefs.public.brain.callReview.reviewCallMaintenance,
} as const;

export type BrainPageMutationResult<T> = T | Either.Either<T, unknown>;

export type BrainWorkspaceMutationInputs = {
  readonly create: (
    args: Ref.Args<typeof brainWorkspaceRefs.create>,
  ) => Promise<
    BrainPageMutationResult<Ref.Returns<typeof brainWorkspaceRefs.create>>
  >;
  readonly rename: (
    args: Ref.Args<typeof brainWorkspaceRefs.rename>,
  ) => Promise<
    BrainPageMutationResult<Ref.Returns<typeof brainWorkspaceRefs.rename>>
  >;
  readonly favorite?: (
    args: Ref.Args<typeof brainWorkspaceRefs.favorite>,
  ) => Promise<
    BrainPageMutationResult<Ref.Returns<typeof brainWorkspaceRefs.favorite>>
  >;
  readonly archive?: (
    args: Ref.Args<typeof brainWorkspaceRefs.archive>,
  ) => Promise<
    BrainPageMutationResult<Ref.Returns<typeof brainWorkspaceRefs.archive>>
  >;
  readonly move?: (
    args: Ref.Args<typeof brainWorkspaceRefs.move>,
  ) => Promise<
    BrainPageMutationResult<Ref.Returns<typeof brainWorkspaceRefs.move>>
  >;
  readonly restore?: (
    args: Ref.Args<typeof brainWorkspaceRefs.restore>,
  ) => Promise<
    BrainPageMutationResult<Ref.Returns<typeof brainWorkspaceRefs.restore>>
  >;
};

export type BrainPilotAdapter = {
  readonly submitNote?: (input: {
    readonly title: string;
    readonly markdown: string;
  }) => Promise<BrainPilotSourceSummary>;
  readonly reviewNote?: (input: {
    readonly sourceKey: string;
    readonly decision: "approve" | "reject";
  }) => Promise<BrainPilotSourceSummary>;
};

export type BrainPilotSourceSummary = {
  readonly sourceKey: string;
  readonly status: "pending_review" | "published" | "rejected";
};

export type BrainWorkspaceAdapter = BrainPilotAdapter & {
  readonly brainKey: string;
  readonly canEdit: boolean;
  readonly createPage: BrainWorkspaceMutationInputs["create"];
  readonly renamePage: BrainWorkspaceMutationInputs["rename"];
  readonly favoritePage?: BrainWorkspaceMutationInputs["favorite"];
  readonly archivePage?: BrainWorkspaceMutationInputs["archive"];
  readonly movePage?: (
    args: Omit<Ref.Args<typeof brainWorkspaceRefs.move>, "brainKey">,
  ) => Promise<
    BrainPageMutationResult<Ref.Returns<typeof brainWorkspaceRefs.move>>
  >;
  readonly restorePage?: BrainWorkspaceMutationInputs["restore"];
  readonly updatePage?: (input: {
    readonly pageKey: string;
    readonly expectedCurrentRevisionKey: string;
    readonly markdown: string;
  }) => Promise<BrainPageUpdateData>;
};

export const createBrainWorkspaceAdapter = ({
  brainKey,
  canEdit,
  mutations,
  pilot,
  movePage,
  restorePage,
  updatePage,
}: {
  readonly brainKey: string;
  readonly canEdit: boolean;
  readonly mutations: BrainWorkspaceMutationInputs;
  readonly pilot?: BrainPilotAdapter;
  readonly movePage?: BrainWorkspaceAdapter["movePage"];
  readonly restorePage?: BrainWorkspaceAdapter["restorePage"];
  readonly updatePage?: BrainWorkspaceAdapter["updatePage"];
}): BrainWorkspaceAdapter => ({
  brainKey,
  canEdit,
  ...pilot,
  createPage: mutations.create,
  renamePage: mutations.rename,
  ...definedBrainWorkspaceMethods({
    favoritePage: mutations.favorite,
    archivePage: mutations.archive,
    movePage,
    restorePage,
    updatePage,
  }),
});

const definedBrainWorkspaceMethods = (
  methods: Pick<
    BrainWorkspaceAdapter,
    "favoritePage" | "archivePage" | "movePage" | "restorePage" | "updatePage"
  >,
): Partial<typeof methods> =>
  Object.fromEntries(
    Object.entries(methods).filter(([, method]) => method !== undefined),
  ) as Partial<typeof methods>;

export const unwrapBrainMutation = <T>(
  result: BrainPageMutationResult<T>,
): T => {
  if (Either.isEither(result)) {
    if (Either.isLeft(result)) throw result.left;
    return result.right;
  }
  return result;
};

type BrainReadiness = "ready" | "empty" | "partial" | "stale" | "unavailable";

const classifyBrainReadiness = ({
  entries,
  coverage,
  omissions,
}: {
  readonly entries: readonly BrainSearchResult[];
  readonly coverage: readonly BrainCoverage[];
  readonly omissions: readonly BrainOmission[];
}): BrainReadiness => {
  const candidates: readonly (readonly [boolean, BrainReadiness])[] = [
    [
      entries.length === 0 && coverage.some(requiredCoverageUnavailable),
      "unavailable",
    ],
    [
      [
        omissions.some(hasOmittedResults),
        entries.some(isTruncatedResult),
        coverage.some(isIncompleteCoverage),
      ].some(Boolean),
      "partial",
    ],
    [
      [
        entries.some(hasNonCurrentFreshness),
        coverage.some(hasNonCurrentFreshness),
      ].some(Boolean),
      "stale",
    ],
    [entries.length === 0, "empty"],
  ];
  return candidates.find(([matches]) => matches)?.[1] ?? "ready";
};

const unavailableCoverageStatuses = new Set<BrainCoverage["status"]>([
  "unavailable",
  "unknown",
]);

const requiredCoverageUnavailable = (coverage: BrainCoverage): boolean =>
  [coverage.required, unavailableCoverageStatuses.has(coverage.status)].every(
    Boolean,
  );

const hasOmittedResults = ({ count }: BrainOmission): boolean => count > 0;
const isTruncatedResult = ({ truncated }: BrainSearchResult): boolean =>
  truncated;
const isIncompleteCoverage = ({ status }: BrainCoverage): boolean =>
  status !== "complete";
const hasNonCurrentFreshness = ({
  freshness,
}: BrainSearchResult | BrainCoverage): boolean => freshness !== "current";

const errorStringProperty = (
  error: unknown,
  property: "_tag" | "message",
): string | undefined => {
  const value = Reflect.get(Object(error), property) as unknown;
  return typeof value === "string" ? value : undefined;
};

const toBrainReadFailure = (
  state: Exclude<
    TemplateDataState<unknown, unknown>,
    { status: "skipped" | "loading" | "empty" | "ready" }
  >,
): BrainReadFailureState => {
  const error = state.status === "typed_failure" ? state.error : undefined;
  const tag = errorStringProperty(error, "_tag") ?? "";
  const message =
    errorStringProperty(error, "message") ??
    (state.status === "typed_failure" ? undefined : state.message);
  const status = readFailureStatus(tag, message);
  return {
    status,
    message: message ?? defaultReadFailureMessage[status],
  };
};

const readFailureStatus = (
  tag: string,
  message: string | undefined,
): BrainReadFailureState["status"] => {
  const candidates = [
    [tag.includes("Integrity"), "integrity_failure"],
    [
      [tag.includes("Capacity"), /capacity/i.test(message ?? "")].some(Boolean),
      "capacity_failure",
    ],
  ] as const;
  return candidates.find(([matches]) => matches)?.[1] ?? "unavailable";
};

const defaultReadFailureMessage = {
  integrity_failure: "Exact citation validation failed.",
  capacity_failure: "Brain retrieval capacity was exceeded.",
  unavailable: "Brain data is unavailable.",
} as const satisfies Record<BrainReadFailureState["status"], string>;

const unavailableCoverageMessage = (
  coverage: readonly BrainCoverage[],
): string => {
  const scopes = coverage
    .filter(requiredCoverageUnavailable)
    .map(({ corpusKey, connectorScopeKey }) =>
      connectorScopeKey.length > 0
        ? `${corpusKey}/${connectorScopeKey}`
        : corpusKey,
    );
  return scopes.length === 0
    ? "Required Brain coverage is unavailable."
    : `Required Brain coverage is unavailable for ${scopes.join(", ")}.`;
};

export const toBrainSearchState = (
  state: TemplateDataState<BrainSourcesSearchData, unknown>,
  query: string,
): BrainSearchState =>
  hasBrainReadData(state)
    ? presentBrainSearchData(state.data, query)
    : presentBrainSearchWithoutData(state, query);

const presentBrainSearchData = (
  data: BrainSourcesSearchData,
  query: string,
): BrainSearchState => {
  const readiness = classifyBrainReadiness({
    entries: data.results,
    coverage: data.coverage,
    omissions: data.omissions,
  });
  if (readiness === "empty") return { status: "empty", query };
  if (readiness === "unavailable") {
    return {
      status: "unavailable",
      query,
      message: unavailableCoverageMessage(data.coverage),
    };
  }
  return {
    status: readiness,
    query,
    results: data.results,
    coverage: data.coverage,
    omissions: data.omissions,
  };
};

const presentBrainSearchWithoutData = (
  state: Exclude<
    TemplateDataState<BrainSourcesSearchData, unknown>,
    { readonly status: "ready" | "empty" }
  >,
  query: string,
): BrainSearchState => {
  if (state.status === "skipped") return { status: "idle" };
  if (state.status === "loading") return { status: "loading", query };
  return { ...toBrainReadFailure(state), query };
};

export const toBrainContextState = (
  state: TemplateDataState<BrainContextPackData, unknown>,
): BrainContextState =>
  hasBrainReadData(state)
    ? presentBrainContextData(state.data)
    : presentBrainReadWithoutData(state);

const presentBrainContextData = (
  data: BrainContextPackData,
): BrainContextState => {
  const readiness = classifyBrainReadiness({
    entries: data.entries,
    coverage: data.coverage,
    omissions: data.omissions,
  });
  if (readiness === "unavailable") {
    return {
      status: "unavailable",
      message: unavailableCoverageMessage(data.coverage),
    };
  }
  return { status: readiness, data };
};

export const toBrainSourceState = (
  state: TemplateDataState<BrainSourceGetData, unknown>,
): BrainSourceState =>
  state.status === "ready"
    ? presentBrainSourceData(state.data)
    : presentBrainSourceWithoutData(state);

const presentBrainSourceData = (data: BrainSourceGetData): BrainSourceState => {
  const stale = [
    data.freshness !== "current",
    data.status === "superseded",
  ].some(Boolean);
  return { status: stale ? "stale" : "ready", data };
};

const presentBrainSourceWithoutData = (
  state: Exclude<
    TemplateDataState<BrainSourceGetData, unknown>,
    { readonly status: "ready" }
  >,
): BrainSourceState => {
  if (state.status === "empty")
    return {
      status: "unavailable",
      message: "The exact Brain citation is unavailable.",
    };
  return presentBrainReadWithoutData(state);
};

const presentBrainReadWithoutData = (
  state: Exclude<
    TemplateDataState<unknown, unknown>,
    { readonly status: "ready" | "empty" }
  >,
): BrainReadFailureState | { readonly status: "idle" | "loading" } => {
  if (state.status === "skipped") return { status: "idle" };
  if (state.status === "loading") return { status: "loading" };
  return toBrainReadFailure(state);
};

const hasBrainReadData = <T, E>(
  state: TemplateDataState<T, E>,
): state is Extract<
  TemplateDataState<T, E>,
  { readonly status: "ready" | "empty" }
> => brainReadDataStatuses.has(state.status);

const brainReadDataStatuses = new Set<
  TemplateDataState<unknown, unknown>["status"]
>(["ready", "empty"]);

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
  if (state.status === "typed_failure") return typedFailureCopy(state);
  const staticCopy =
    staticBrainStateCopy[state.status as keyof typeof staticBrainStateCopy];
  if (staticCopy !== undefined) return staticCopy;
  const failureStatus = state.status as keyof typeof brainFailureHeadings;
  return {
    status: failureStatus,
    heading: brainFailureHeadings[failureStatus],
    body: Reflect.get(Object(state), "message") as string,
  };
}

const staticBrainStateCopy = {
  skipped: {
    status: "skipped",
    heading: "Brain source request skipped",
    body: "No workspace context has been selected yet.",
  },
  loading: {
    status: "loading",
    heading: "Loading Brain sources",
    body: "The app is resolving approved markdown, links, notes, and evidence snapshots.",
  },
  empty: {
    status: "empty",
    heading: "No approved Brain sources yet",
    body: "Add markdown, links, or notes before asking agents to produce source-grounded output.",
  },
} as const satisfies Partial<Record<BrainStateCopy["status"], BrainStateCopy>>;

const brainFailureHeadings = {
  transport_failure: "Brain sources are temporarily unavailable",
  parse_failure: "Brain source payload could not be decoded",
  defect: "Unexpected Brain surface defect",
} as const;

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
