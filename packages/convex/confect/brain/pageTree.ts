import * as Schema from "effect/Schema";
import { PageKey, RevisionKey } from "./pageSchemas";

export { BrainNotFound } from "../identity/stableKeys";

export class PageNotFound extends Schema.TaggedError<PageNotFound>()(
  "PageNotFound",
  { pageKey: PageKey },
) {}

export class PageTreeConflict extends Schema.TaggedError<PageTreeConflict>()(
  "PageTreeConflict",
  { reason: Schema.String },
) {}

export class StaleRevision extends Schema.TaggedError<StaleRevision>()(
  "StaleRevision",
  {
    pageKey: PageKey,
    expectedCurrentRevisionKey: Schema.NullOr(RevisionKey),
    actualCurrentRevisionKey: Schema.NullOr(RevisionKey),
  },
) {}

export class LifecycleRevoked extends Schema.TaggedError<LifecycleRevoked>()(
  "LifecycleRevoked",
  { resource: Schema.String, key: Schema.String },
) {}

export const usableTitle = (title: string): string | null => {
  const normalized = title.trim();
  return normalized.length === 0 || normalized.length > 160 ? null : normalized;
};

export const cycleConflict = (input: {
  readonly pageKey: string;
  readonly parentPageKey: string | null;
  readonly parentByPageKey: ReadonlyMap<string, string | null>;
}): PageTreeConflict | null => {
  let cursor = input.parentPageKey;
  const seen = new Set<string>([input.pageKey]);
  while (cursor !== null) {
    if (seen.has(cursor))
      return new PageTreeConflict({
        reason: "Page move would create a cycle.",
      });
    seen.add(cursor);
    cursor = input.parentByPageKey.get(cursor) ?? null;
  }
  return null;
};
