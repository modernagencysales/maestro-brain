import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import {
  createAsyncSearchService,
  MAX_SEARCH_LIMIT,
  SearchProvider,
  SearchQueryInvalid,
  type SearchDocument,
  type SearchProviderAdapter,
} from "./index";

const documents: readonly SearchDocument[] = [
  {
    workspaceSlug: "acme-demo",
    brainKey: "brain_client_acme",
    projectionKey: "proj_positioning",
    revisionKey: "rev_positioning",
    sourceTitle: "Founder interview notes",
    text: "Positioning: the product is a typed workflow brain for operators.",
  },
  {
    workspaceSlug: "other-tenant",
    brainKey: "brain_other",
    projectionKey: "proj_leak",
    revisionKey: "rev_leak",
    sourceTitle: "Other tenant secrets",
    text: "Positioning notes that must never leak across workspaces.",
  },
];

const unusedLiveAdapter: SearchProviderAdapter = {
  search: () => Effect.succeed({ candidates: [], nextCursor: null }),
};

const runWithProvider = <A, E>(
  effect: Effect.Effect<A, E, SearchProvider>,
  adapter: SearchProviderAdapter = unusedLiveAdapter,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provideService(SearchProvider, adapter)),
  );

describe("search package public surface", () => {
  it("exports only the asynchronous search service", async () => {
    const service = createAsyncSearchService({ mode: "test", documents });

    const page = await runWithProvider(
      service.search({
        workspaceSlug: "acme-demo",
        brainKey: "brain_client_acme",
        query: "positioning",
      }),
    );

    expect(page.candidates.map((candidate) => candidate.projectionKey)).toEqual(
      ["proj_positioning"],
    );
  });

  it("keeps sync and fake-mode access out of production imports", () => {
    type PublicExports = typeof import("./index");
    type SearchModeOption = Parameters<
      typeof createAsyncSearchService
    >[0]["mode"];
    // @ts-expect-error createSearchService was the old synchronous API and is no longer exported.
    type SyncFactory = PublicExports["createSearchService"];
    // @ts-expect-error fake mode is not public; tests use the async rollback provider.
    const rejectedMode: SearchModeOption = "fake";

    const acceptedModes: readonly SearchModeOption[] = ["test", "live"];
    expect(acceptedModes).toEqual(["test", "live"]);
    expect(rejectedMode).toBe("fake");
    expect(true satisfies SyncFactory extends never ? true : true).toBe(true);
  });

  it("rejects invalid caps through the async typed error", async () => {
    const service = createAsyncSearchService({ mode: "test", documents });

    await expect(
      runWithProvider(
        service.search({
          workspaceSlug: "acme-demo",
          brainKey: "brain_client_acme",
          query: "positioning",
          cap: MAX_SEARCH_LIMIT + 1,
        }),
      ),
    ).rejects.toMatchObject({
      name: expect.stringContaining(SearchQueryInvalid.name),
    });
  });
});
