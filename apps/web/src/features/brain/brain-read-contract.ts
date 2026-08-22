import type { Ref } from "@confect/core";
import {
  templateConfectRefs,
  type TemplateConfectRefs,
} from "@maestro-template/convex/refs";

type BrainReadApiRefs = TemplateConfectRefs["public"]["brain"]["readApi"];

export const brainReadApiRefs = {
  sourcesSearch: templateConfectRefs.public.brain.readApi.sourcesSearch,
  sourcesGet: templateConfectRefs.public.brain.readApi.sourcesGet,
  contextGet: templateConfectRefs.public.brain.readApi.contextGet,
  brainRolloutStatus:
    templateConfectRefs.public.brain.readApi.brainRolloutStatus,
} as const satisfies Pick<
  BrainReadApiRefs,
  "sourcesSearch" | "sourcesGet" | "contextGet" | "brainRolloutStatus"
>;

export type BrainSourcesSearchData = Ref.Returns<
  typeof brainReadApiRefs.sourcesSearch
>;
export type BrainSearchResult = BrainSourcesSearchData["results"][number];
export type BrainSearchCoverage = BrainSourcesSearchData["coverage"][number];
export type BrainSourceGetData = Ref.Returns<
  typeof brainReadApiRefs.sourcesGet
>;
export type BrainContextPackData = Ref.Returns<
  typeof brainReadApiRefs.contextGet
>;
export type BrainContextPackEntry = BrainContextPackData["entries"][number];
export type BrainContextPackCoverage = BrainContextPackData["coverage"][number];
export type BrainOmission = BrainContextPackData["omissions"][number];
export type CandidateManifestV2Data = BrainContextPackData["candidateManifest"];
export type BrainRolloutStatusData = Ref.Returns<
  typeof brainReadApiRefs.brainRolloutStatus
>;
export type BrainRolloutBlocker =
  BrainRolloutStatusData["scopes"][number]["blockers"][number];
