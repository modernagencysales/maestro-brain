import type { BrainPageDetail, BrainPageListData } from "./brain-surface";

export type BrainPageListState =
  | { readonly status: "loading" | "skipped" }
  | { readonly status: "empty"; readonly data: BrainPageListData }
  | { readonly status: "ready"; readonly data: BrainPageListData }
  | { readonly status: "failure"; readonly message: string };

export type BrainPageDetailState =
  | { readonly status: "loading" | "skipped" }
  | { readonly status: "ready"; readonly data: BrainPageDetail }
  | { readonly status: "failure"; readonly message: string };

export type BrainReviewNotice = {
  readonly status: "success" | "failure";
  readonly message: string;
};

export type BrainWorkspaceActionState =
  | {
      readonly status: "pending_review" | "published" | "rejected";
      readonly sourceKey: string;
    }
  | { readonly status: "saved" | "moved" }
  | { readonly status: "stale_conflict" | "lifecycle_conflict" }
  | { readonly status: "unavailable" | "failure"; readonly message: string };
