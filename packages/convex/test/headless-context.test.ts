import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import convexSchema from "../confect/_generated/convexSchema";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");
const makeTest = () => convexTest(convexSchema, modules);
const contextGet = makeFunctionReference<
  "query",
  {
    organizationId: string;
    workspaceId: string;
    brainKey: string;
    question?: string;
    pageKeys?: string[];
    maxBytes?: number;
  },
  {
    brainKey: string;
    entries: Array<{ sourceKey: string; excerpt: string }>;
  }
>("brain/readApi:headlessContextGet");
const sourcesSearch = makeFunctionReference<
  "query",
  {
    organizationId: string;
    workspaceId: string;
    brainKey: string;
    query: string;
  }
>("brain/readApi:headlessSourcesSearch");
const sourcesGet = makeFunctionReference<
  "query",
  {
    organizationId: string;
    workspaceId: string;
    brainKey: string;
    sourceRevisionKey: string;
  }
>("brain/readApi:headlessSourcesGet");
const answersAsk = makeFunctionReference<
  "query",
  {
    organizationId: string;
    workspaceId: string;
    brainKey: string;
    question: string;
  }
>("brain/readApi:headlessAnswersAsk");

describe("headless Brain context", () => {
  it("reads only pages bound to the authenticated organization, workspace, and Brain", async () => {
    const t = makeTest();
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "headless-context-test",
        email: "headless-context@example.test",
        displayName: "Headless Context",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const organizationId = await ctx.db.insert("organizations", {
        ownerUserId: userId,
        agencyKey: "ag_01J0000000000000000000000A",
        slug: "headless-context",
        name: "Headless Context",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
        lifecycleGeneration: 1,
        revocationGeneration: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        organizationId,
        ownerUserId: userId,
        brainKey: "br_01J0000000000000000000000B",
        slug: "headless-context",
        name: "Headless Context",
        status: "active",
        dataClassification: "internal",
        createdAt: 1,
        updatedAt: 1,
        lifecycleGeneration: 1,
        revocationGeneration: 0,
      });
      const foreignOrganizationId = await ctx.db.insert("organizations", {
        ownerUserId: userId,
        slug: "foreign-context",
        name: "Foreign Context",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const foreignWorkspaceId = await ctx.db.insert("workspaces", {
        organizationId: foreignOrganizationId,
        ownerUserId: userId,
        brainKey: "br_01J0000000000000000000000C",
        slug: "foreign-context",
        name: "Foreign Context",
        status: "active",
        dataClassification: "internal",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("brainPages", {
        workspaceId,
        organizationId,
        slug: "launch-context",
        title: "Launch context",
        markdown: "verified from the installed CLI",
        sourceKind: "markdown",
        updatedAt: 1,
        pageKey: "pag_launch_context",
        parentPageKey: null,
        siblingSlug: "launch-context",
        sortKey: "0000000001",
        favorite: false,
        status: "active",
        currentRevisionKey: null,
        lifecycle: {
          state: "active",
          generation: 1,
          updatedAt: 1,
          purgeAfter: null,
        },
        createdAt: 1,
        schemaVersion: 1,
      });
      await ctx.db.insert("brainSources", {
        workspaceId,
        organizationId,
        sourceKey: "src_launch_context",
        title: "Launch source",
        markdown: "verified source from the installed CLI",
        status: "published",
        submittedAt: 1,
        reviewedAt: 1,
        schemaVersion: 1,
      });
      const publicationSetKey = `rset_${"c".repeat(64)}`;
      const entryKey = `rent_${"a".repeat(64)}`;
      await ctx.db.insert("retrievalPublicationSets", {
        schemaVersion: 1,
        organizationKey: "ag_01J0000000000000000000000A",
        workspaceId,
        brainKey: "br_01J0000000000000000000000B",
        corpusKey: "test-projection",
        publicationSetKey,
        publicationGeneration: 1,
        originKind: "projection",
        originTable: "brainSources",
        sourceKey: "src_launch_context",
        sourceRevisionKey: "src_launch_context",
        routeGeneration: 1,
        lifecycleGeneration: 1,
        policyGeneration: 1,
        expectedEntryCount: 1,
        expectedTokenCount: 2,
        manifestHash: `sha256:${"d".repeat(64)}`,
        state: "current",
        createdAt: 1,
        activatedAt: 1,
      });
      await ctx.db.insert("retrievalEntries", {
        schemaVersion: 1,
        organizationKey: "ag_01J0000000000000000000000A",
        workspaceId,
        brainKey: "br_01J0000000000000000000000B",
        entryKey,
        publicationSetKey,
        publicationGeneration: 1,
        kind: "projection",
        corpusKey: "test-projection",
        origin: {
          kind: "projection",
          projectionKey: "src_launch_context",
          revisionKey: "src_launch_context",
        },
        originTable: "brainSources",
        sourceKey: "src_launch_context",
        sourceRevisionKey: "src_launch_context",
        passageKey: `rpass_${"b".repeat(64)}`,
        startOffset: 0,
        endOffset: 45,
        title: "Launch source",
        headingPath: null,
        text: "verified source from the installed CLI",
        contentHash: `sha256:${"e".repeat(64)}`,
        observedAt: 1,
        indexedAt: 1,
        authority: "derived",
        authorityPolicyKey: "test",
        policyGeneration: 1,
        lifecycleGeneration: 1,
        routeGeneration: 1,
        state: "published",
      });
      for (const token of ["installed", "cli"])
        await ctx.db.insert("retrievalTokens", {
          schemaVersion: 1,
          organizationKey: "ag_01J0000000000000000000000A",
          workspaceId,
          brainKey: "br_01J0000000000000000000000B",
          publicationSetKey,
          tokenizerVersion: 1,
          token,
          entryKey,
          authorityRank: 2,
          termFrequency: 1,
          inTitle: false,
          inHeading: false,
        });
      await ctx.db.insert("brainCorpusHealth", {
        schemaVersion: 1,
        organizationKey: "ag_01J0000000000000000000000A",
        workspaceId,
        brainKey: "br_01J0000000000000000000000B",
        corpusKey: "test-projection",
        policyGeneration: 1,
        coverageStatus: "partial",
        lastObservedAt: 1,
        lastPublishedAt: 1,
        freshnessThresholdMs: 1,
        discoveredCount: 1,
        publishedCount: 1,
        failedCount: 0,
        updatedAt: 1,
      });
      return {
        organizationId,
        workspaceId,
        foreignOrganizationId,
        foreignWorkspaceId,
      };
    });
    const principal = {
      organizationId: ids.organizationId,
      workspaceId: ids.workspaceId,
      brainKey: "br_01J0000000000000000000000B",
    };

    await expect(
      t.query(contextGet, { ...principal, question: "installed CLI" }),
    ).resolves.toMatchObject({
      brainKey: "br_01J0000000000000000000000B",
      entries: [
        {
          sourceKey: "src_launch_context",
          excerpt: "verified source from the installed CLI",
        },
      ],
    });
    await expect(
      t.query(sourcesSearch, { ...principal, query: "installed CLI" }),
    ).resolves.toMatchObject({
      brainKey: principal.brainKey,
      results: [{ sourceKey: "src_launch_context" }],
    });
    await expect(
      t.query(sourcesGet, {
        ...principal,
        sourceRevisionKey: "src_launch_context",
      }),
    ).resolves.toMatchObject({
      brainKey: principal.brainKey,
      sourceKey: "src_launch_context",
      status: "published",
    });
    await expect(
      t.query(answersAsk, { ...principal, question: "installed CLI" }),
    ).resolves.toMatchObject({
      brainKey: principal.brainKey,
      response: { status: "abstained" },
    });
    await expect(
      t.query(contextGet, { ...principal, brainKey: "br_wrong" }),
    ).rejects.toThrow();
    await expect(
      t.query(contextGet, {
        ...principal,
        organizationId: ids.foreignOrganizationId,
      }),
    ).rejects.toThrow();
    await expect(
      t.query(contextGet, {
        ...principal,
        workspaceId: ids.foreignWorkspaceId,
      }),
    ).rejects.toThrow();

    await t.run(async (ctx) => {
      await ctx.db.patch(ids.workspaceId, { status: "archived" });
    });
    await expect(t.query(contextGet, principal)).rejects.toThrow();
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.workspaceId, {
        status: "active",
        revocationGeneration: 2,
      });
    });
    await expect(t.query(contextGet, principal)).rejects.toThrow();
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.workspaceId, {
        revocationGeneration: 0,
      });
      await ctx.db.patch(ids.organizationId, { status: "archived" });
    });
    await expect(t.query(contextGet, principal)).rejects.toThrow();
  });
});
