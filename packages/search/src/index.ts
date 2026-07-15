export type SearchMode = "test" | "live";

// invariant: retrieval feeds bounded prompt context; higher recall comes from
// re-querying, not from raising this cap.
export const MAX_SEARCH_LIMIT = 50;

export * from "./asyncSearch";
