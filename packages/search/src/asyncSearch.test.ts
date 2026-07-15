import { describe, expect, it } from "vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import {
  createAsyncSearchService,
  SearchProvider,
  SearchCursorInvalid,
  SearchQueryInvalid,
  SearchTimeout,
  SearchUnavailable,
  type SearchDocument,
  type SearchProviderAdapter,
} from "./asyncSearch";

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
    workspaceSlug: "acme-demo",
    brainKey: "brain_client_acme",
    projectionKey: "proj_pricing",
    revisionKey: "rev_pricing",
    sourceTitle: "Product docs and policies",
    text: "Pricing policy: credits are prepaid and workflow runs draw down.",
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

const runWithProvider = <A, E>(
  effect: Effect.Effect<A, E, SearchProvider>,
  adapter: SearchProviderAdapter,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provideService(SearchProvider, adapter)),
  );

const expectFailureTag = async <A>(
  effect: Promise<A>,
  tag: string,
): Promise<void> => {
  await expect(effect).rejects.toMatchObject({
    name: expect.stringContaining(tag),
  });
};

describe("async search service", () => {
  it("matches fake and live provider contract shape", async () => {
    const fake = createAsyncSearchService({ mode: "test", documents });
    const live = createAsyncSearchService({ mode: "live" });
    const liveAdapter: SearchProviderAdapter = {
      search: () =>
        Effect.succeed({
          candidates: [
            {
              projectionKey: "proj_positioning",
              revisionKey: "rev_positioning",
              sourceTitle: "Founder interview notes",
              snippet:
                "Positioning: the product is a typed workflow brain for operators.",
              score: 0.9,
              order: 0,
            },
          ],
          nextCursor: null,
        }),
    };

    const [fakePage, livePage] = await Promise.all([
      runWithProvider(
        fake.search({
          workspaceSlug: "acme-demo",
          brainKey: "brain_client_acme",
          query: "positioning",
          cap: 1,
        }),
        {
          search: () =>
            Effect.fail(new SearchUnavailable({ retryable: false })),
        },
      ),
      runWithProvider(
        live.search({
          workspaceSlug: "acme-demo",
          brainKey: "brain_client_acme",
          query: "positioning",
          cap: 1,
        }),
        liveAdapter,
      ),
    ]);

    expect(fakePage.candidates[0]).toMatchObject({
      projectionKey: "proj_positioning",
      revisionKey: "rev_positioning",
      order: 0,
    });
    expect(livePage.candidates[0]).toMatchObject({
      projectionKey: "proj_positioning",
      revisionKey: "rev_positioning",
      order: 0,
    });
  });

  it("propagates cap, filters, and cursor to the live provider", async () => {
    const calls: unknown[] = [];
    const service = createAsyncSearchService({ mode: "live" });

    await runWithProvider(
      service.search({
        workspaceSlug: "acme-demo",
        brainKey: "brain_client_acme",
        query: "  pricing  ",
        cap: 7,
        cursor: "cursor-1",
        filters: { kind: "page", lifecycle: "active" },
      }),
      {
        search: (input) => {
          calls.push(input);
          return Effect.succeed({ candidates: [], nextCursor: null });
        },
      },
    );

    expect(calls).toEqual([
      {
        workspaceSlug: "acme-demo",
        brainKey: "brain_client_acme",
        query: "pricing",
        cap: 7,
        cursor: "cursor-1",
        filters: { kind: "page", lifecycle: "active" },
      },
    ]);
  });

  it("keeps deterministic fake ordering and tenant filters", async () => {
    const service = createAsyncSearchService({ mode: "test", documents });
    const page = await runWithProvider(
      service.search({
        workspaceSlug: "acme-demo",
        brainKey: "brain_client_acme",
        query: "workflow positioning product",
      }),
      {
        search: () => Effect.fail(new SearchUnavailable({ retryable: false })),
      },
    );

    expect(page.candidates.map((hit) => hit.projectionKey)).toEqual([
      "proj_positioning",
      "proj_pricing",
    ]);
    expect(
      page.candidates.every((hit) => hit.projectionKey !== "proj_leak"),
    ).toBe(true);
  });

  it("maps invalid queries, provider failures, and timeouts to typed errors", async () => {
    const fake = createAsyncSearchService({ mode: "test", documents });
    await expectFailureTag(
      runWithProvider(
        fake.search({
          workspaceSlug: "acme-demo",
          brainKey: "brain_client_acme",
          query: " ",
        }),
        {
          search: () =>
            Effect.fail(new SearchUnavailable({ retryable: false })),
        },
      ),
      SearchQueryInvalid.name,
    );

    const live = createAsyncSearchService({ mode: "live", timeoutMillis: 5 });
    await expectFailureTag(
      runWithProvider(
        live.search({
          workspaceSlug: "acme-demo",
          brainKey: "brain_client_acme",
          query: "pricing",
        }),
        {
          search: () => Effect.fail(new SearchUnavailable({ retryable: true })),
        },
      ),
      SearchUnavailable.name,
    );

    await expectFailureTag(
      runWithProvider(
        live.search({
          workspaceSlug: "acme-demo",
          brainKey: "brain_client_acme",
          query: "pricing",
        }),
        { search: () => Effect.never },
      ),
      SearchTimeout.name,
    );
  });

  it("rejects malformed cursors before reaching providers", async () => {
    const calls: unknown[] = [];
    const live = createAsyncSearchService({ mode: "live" });

    await expectFailureTag(
      runWithProvider(
        live.search({
          workspaceSlug: "acme-demo",
          brainKey: "brain_client_acme",
          query: "pricing",
          cursor: "bad cursor",
        }),
        {
          search: (input) => {
            calls.push(input);
            return Effect.succeed({ candidates: [], nextCursor: null });
          },
        },
      ),
      SearchCursorInvalid.name,
    );

    expect(calls).toEqual([]);
  });

  it("interrupts the provider when the search is interrupted", async () => {
    let interrupted = false;

    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const service = createAsyncSearchService({ mode: "live" });
        const adapter: SearchProviderAdapter = {
          search: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.zipRight(Effect.never),
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
        };

        const fiber = yield* Effect.fork(
          service
            .search({
              workspaceSlug: "acme-demo",
              brainKey: "brain_client_acme",
              query: "pricing",
            })
            .pipe(Effect.provideService(SearchProvider, adapter)),
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
      }),
    );

    expect(interrupted).toBe(true);
  });
  it("rejects synchronous consumer use at compile time", () => {
    const service = createAsyncSearchService({ mode: "test", documents });
    // @ts-expect-error async search returns an Effect, not a synchronous page.
    const page: { readonly candidates: readonly unknown[] } = service.search({
      workspaceSlug: "acme-demo",
      brainKey: "brain_client_acme",
      query: "positioning",
    });

    expect(page).toBeDefined();
  });
});
