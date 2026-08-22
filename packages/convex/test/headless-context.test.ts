import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { normalizeDriveFile } from "@maestro-template/integrations/googleDrive/canonical";

import convexSchema from "../confect/_generated/convexSchema";
import {
  buildRetrievalPassages,
  retrievalEligibilityFenceKey,
  retrievalPublicationSubjectKey,
} from "../confect/brain/retrievalPublication";
import { retrievalTokenCatalogProjection } from "../confect/brain/retrievalTokenCatalog";
import { publicationManifestHash } from "../confect/brain/publicationIntegrity";
import {
  connectionFenceIdentity,
  connectorAllowlistFenceIdentity,
  connectorScopeFenceIdentity,
  documentLifecycleFenceIdentity,
} from "../confect/brain/retrievalEligibility";
import type {
  CommitDriveObservationArgs,
  CommitDriveObservationResult,
} from "../confect/integrations/driveLedgerSchemas";

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
    coverage: Array<{
      sourceKind: string;
      status: "complete" | "partial" | "unavailable" | "unknown";
    }>;
  }
>("brain/readApi:validationContextGet");
const sourcesSearch = makeFunctionReference<
  "query",
  {
    organizationId: string;
    workspaceId: string;
    brainKey: string;
    query: string;
  }
>("brain/readApi:validationSourcesSearch");
const sourcesGet = makeFunctionReference<
  "query",
  {
    organizationId: string;
    workspaceId: string;
    brainKey: string;
    sourceRevisionKey: string;
  }
>("brain/readApi:validationSourcesGet");
const answersAsk = makeFunctionReference<
  "query",
  {
    organizationId: string;
    workspaceId: string;
    brainKey: string;
    question: string;
  }
>("brain/readApi:headlessAnswersAsk");
const commitDriveObservation = makeFunctionReference<
  "mutation",
  CommitDriveObservationArgs,
  CommitDriveObservationResult
>("integrations/driveSource:commitObservation");

describe("headless Brain projection validation context", () => {
  it("rejects legacy projection origins while preserving tenant boundaries", async () => {
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
      const sourceMarkdown = "verified source from the installed CLI";
      const sourcePassage = buildRetrievalPassages(
        sourceMarkdown,
        "src_launch_context",
      )[0];
      if (sourcePassage === undefined)
        throw new Error("expected source passage");
      await ctx.db.insert("brainSources", {
        workspaceId,
        organizationId,
        sourceKey: "src_launch_context",
        title: "Launch source",
        markdown: sourceMarkdown,
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
        passageKey: sourcePassage.passageKey,
        startOffset: sourcePassage.startOffset,
        endOffset: sourcePassage.endOffset,
        title: "Launch source",
        headingPath: null,
        text: sourcePassage.text,
        contentHash: sourcePassage.contentHash,
        observedAt: 1,
        indexedAt: 1,
        authority: "derived",
        authorityPolicyKey: "test",
        policyGeneration: 1,
        lifecycleGeneration: 1,
        routeGeneration: 1,
        state: "published",
      });
      for (const token of ["installed", "cli"]) {
        const posting = {
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
        } as const;
        await ctx.db.insert("retrievalTokens", posting);
        const catalog = retrievalTokenCatalogProjection([posting]);
        await ctx.db.insert("retrievalTokenCatalog", {
          schemaVersion: 1,
          organizationKey: posting.organizationKey,
          workspaceId,
          brainKey: posting.brainKey,
          tokenizerVersion: 1,
          token,
          ...catalog,
          updatedAt: 1,
        });
      }
      await ctx.db.insert("channelRoutingPolicies", {
        organizationKey: "ag_01J0000000000000000000000A",
        connectionKey: "slack_headless_context",
        connectionGeneration: 1,
        channelKey: "channel_headless_context",
        policyEpoch: 1,
        active: true,
        mode: "direct",
        targetBrainKeys: ["br_01J0000000000000000000000B"],
        statusAfterApply: "streaming",
        pendingSourceInterval: null,
        createdByRole: "owner",
        createdAt: 1,
      });
      await ctx.db.insert("providerConnections", {
        provider: "nango",
        providerConfigKey: "fireflies",
        organizationKey: "ag_01J0000000000000000000000A",
        connectionKey: "fireflies_headless_context",
        connectionGeneration: 1,
        status: "active",
        connectSessionId: "session_headless_context",
        nangoConnectionId: "connection_headless_context",
        nangoEndUserId: "end_user_headless_context",
        nangoOrganizationId: "organization_headless_context",
        correlationTag: "headless-context",
        attemptId: "attempt_headless_context",
        attemptExpiresAt: 2,
        completedAt: 1,
        createdAt: 1,
        updatedAt: 1,
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
    ).rejects.toThrow(/unsupported_origin/);
    await expect(
      t.query(sourcesSearch, { ...principal, query: "installed CLI" }),
    ).rejects.toThrow(/unsupported_origin/);
    await expect(
      t.query(sourcesGet, {
        ...principal,
        sourceRevisionKey: "src_launch_context",
      }),
    ).rejects.toThrow(/unsupported_origin/);
    await expect(
      t.query(answersAsk, { ...principal, question: "installed CLI" }),
    ).resolves.toMatchObject({
      brainKey: principal.brainKey,
      response: { status: "abstained", reason: "insufficient_evidence" },
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

  it("reopens Drive evidence from its immutable origin and rejects copied corruption", async () => {
    const t = makeTest();
    const revision = normalizeDriveFile({
      scope: {
        connectionKey: "drive_origin_connection",
        connectionGeneration: 1,
        driveId: "drive_origin_shared_drive",
        rootFolderIds: ["drive_origin_folder"],
        allowlistGeneration: 1,
        sharedDrive: true,
      },
      file: {
        id: "drive_origin_file",
        name: "Drive origin",
        mimeType: "application/vnd.google-apps.document",
        version: "1",
        modifiedTime: "2026-08-22T00:00:00.000Z",
        webViewLink: "https://drive.google.com/open?id=drive_origin_file",
        trashed: false,
        parents: ["drive_origin_folder"],
      },
      exportMimeType: "text/plain",
      exportedText: "Drive origin integrity evidence.",
      observedAt: 1,
      permissionSnapshotHash: "a".repeat(64),
      retentionClass: "internal_company",
    });
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "drive-origin-reader",
        email: "drive-origin-reader@example.test",
        displayName: "Drive Origin Reader",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const organizationId = await ctx.db.insert("organizations", {
        ownerUserId: userId,
        agencyKey: "ag_01J0000000000000000000000C",
        slug: "drive-origin-integrity",
        name: "Drive Origin Integrity",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
        lifecycleGeneration: 1,
        revocationGeneration: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        organizationId,
        ownerUserId: userId,
        brainKey: "br_01J0000000000000000000000D",
        slug: "drive-origin-integrity",
        name: "Drive Origin Integrity",
        status: "active",
        dataClassification: "internal",
        createdAt: 1,
        updatedAt: 1,
        lifecycleGeneration: 1,
        revocationGeneration: 0,
      });
      await ctx.db.insert("connectorScopes", {
        schemaVersion: 1,
        organizationKey: "ag_01J0000000000000000000000C",
        connectorScopeKey: revision.connectorScopeKey,
        providerKind: "google_drive",
        providerContainerKey: "drive_origin_shared_drive",
        connectionKey: revision.connectionKey,
        currentConnectionGeneration: revision.connectionGeneration,
        currentAllowlistGeneration: revision.allowlistGeneration,
        scopeGeneration: 1,
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("providerConnections", {
        provider: "nango",
        providerConfigKey: "google-drive",
        organizationKey: "ag_01J0000000000000000000000C",
        connectionKey: revision.connectionKey,
        connectionGeneration: revision.connectionGeneration,
        status: "active",
        connectSessionId: "drive_origin_session",
        nangoConnectionId: "drive_origin_nango",
        nangoEndUserId: "drive_origin_user",
        nangoOrganizationId: "drive_origin_org",
        correlationTag: "drive-origin",
        attemptId: "drive_origin_attempt",
        attemptExpiresAt: 2,
        completedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, workspaceId };
    });
    const committed = await t.mutation(commitDriveObservation, {
      organizationKey: "ag_01J0000000000000000000000C",
      revision,
      expectedIncarnation: null,
    });
    if (committed.documentRevisionKey === null)
      throw new Error("expected committed Drive revision");
    const passage = buildRetrievalPassages(
      revision.normalizedText,
      committed.documentRevisionKey,
    )[0];
    if (passage === undefined) throw new Error("expected Drive passage");
    await t.run(async (ctx) => {
      const organizationKey = "ag_01J0000000000000000000000C";
      const brainKey = "br_01J0000000000000000000000D";
      const publicationSetKey = `rset_${"1".repeat(64)}`;
      const entryKey = `rent_${"2".repeat(64)}`;
      const publicationSubjectKey = retrievalPublicationSubjectKey({
        workspaceId: String(ids.workspaceId),
        brainKey,
        corpusKey: "documents",
        originTable: "documentSourceRevisions",
        kind: "document",
        sourceKey: committed.documentObjectKey,
        connectorScopeKey: revision.connectorScopeKey,
      });
      const fenceIdentities = [
        documentLifecycleFenceIdentity({
          organizationKey,
          documentObjectKey: committed.documentObjectKey,
        }),
        connectorScopeFenceIdentity({
          organizationKey,
          connectorScopeKey: revision.connectorScopeKey,
        }),
        connectorAllowlistFenceIdentity({
          organizationKey,
          connectorScopeKey: revision.connectorScopeKey,
        }),
        connectionFenceIdentity({
          organizationKey,
          connectionKey: revision.connectionKey,
        }),
      ];
      const eligibilityFences = fenceIdentities.map((identity) => ({
        kind: identity.kind,
        fenceKey: retrievalEligibilityFenceKey(identity),
        eligibilityGeneration: 1,
      }));
      const posting = {
        schemaVersion: 1,
        organizationKey,
        workspaceId: ids.workspaceId,
        brainKey,
        publicationSetKey,
        publicationState: "current",
        tokenizerVersion: 1,
        token: "integrity",
        entryKey,
        authorityRank: 1,
        termFrequency: 1,
        inTitle: false,
        inHeading: false,
      } as const;
      await ctx.db.insert("retrievalPublicationSets", {
        schemaVersion: 1,
        organizationKey,
        workspaceId: ids.workspaceId,
        brainKey,
        corpusKey: "documents",
        publicationSubjectKey,
        publicationSetKey,
        publicationGeneration: 1,
        originKind: "document",
        originTable: "documentSourceRevisions",
        connectorScopeKey: revision.connectorScopeKey,
        connectionKey: revision.connectionKey,
        connectionGeneration: revision.connectionGeneration,
        sourceKey: committed.documentObjectKey,
        sourceRevisionKey: committed.documentRevisionKey ?? "",
        routeGeneration: 1,
        lifecycleGeneration: 1,
        policyGeneration: 1,
        eligibilityFences,
        expectedEntryCount: 1,
        expectedTokenCount: 1,
        manifestHash: publicationManifestHash({
          entryKeys: [entryKey],
          tokens: [posting],
        }),
        state: "current",
        createdAt: 1,
        activatedAt: 1,
      });
      await ctx.db.insert("retrievalPublicationSubjects", {
        schemaVersion: 1,
        organizationKey,
        workspaceId: ids.workspaceId,
        brainKey,
        corpusKey: "documents",
        publicationSubjectKey,
        originKind: "document",
        originTable: "documentSourceRevisions",
        connectorScopeKey: revision.connectorScopeKey,
        connectionKey: revision.connectionKey,
        connectionGeneration: revision.connectionGeneration,
        sourceKey: committed.documentObjectKey,
        currentPublicationSetKey: publicationSetKey,
        lastPublicationGeneration: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      for (const [index, identity] of fenceIdentities.entries()) {
        const ref = eligibilityFences[index];
        if (ref === undefined) throw new Error("missing eligibility ref");
        await ctx.db.insert("retrievalEligibilityFences", {
          schemaVersion: 1,
          organizationKey,
          fenceKey: ref.fenceKey,
          kind: identity.kind,
          controllerKey: identity.controllerKey,
          eligibilityGeneration: 1,
          eligible: true,
          updatedAt: 1,
        });
      }
      await ctx.db.insert("retrievalEntries", {
        schemaVersion: 1,
        organizationKey,
        workspaceId: ids.workspaceId,
        brainKey,
        publicationSubjectKey,
        entryKey,
        publicationSetKey,
        publicationGeneration: 1,
        kind: "document",
        corpusKey: "documents",
        origin: {
          kind: "document",
          connectionKey: revision.connectionKey,
          connectorScopeKey: revision.connectorScopeKey,
          objectKey: committed.documentObjectKey,
          revisionKey: committed.documentRevisionKey ?? "",
        },
        originTable: "documentSourceRevisions",
        connectionKey: revision.connectionKey,
        connectionGeneration: revision.connectionGeneration,
        connectorScopeKey: revision.connectorScopeKey,
        sourceKey: committed.documentObjectKey,
        sourceRevisionKey: committed.documentRevisionKey ?? "",
        passageKey: passage.passageKey,
        startOffset: passage.startOffset,
        endOffset: passage.endOffset,
        title: revision.title,
        headingPath: null,
        text: passage.text,
        locator: revision.sourceLocator,
        contentHash: passage.contentHash,
        sourceModifiedAt: revision.sourceModifiedAt,
        observedAt: revision.observedAt,
        indexedAt: 1,
        authority: "authoritative",
        authorityPolicyKey: "drive-origin",
        policyGeneration: 1,
        lifecycleGeneration: 1,
        routeGeneration: 1,
        state: "published",
      });
      await ctx.db.insert("retrievalTokens", posting);
      const catalog = retrievalTokenCatalogProjection([posting]);
      await ctx.db.insert("retrievalTokenCatalog", {
        schemaVersion: 1,
        organizationKey: posting.organizationKey,
        workspaceId: ids.workspaceId,
        brainKey: posting.brainKey,
        tokenizerVersion: 1,
        token: posting.token,
        ...catalog,
        updatedAt: 1,
      });
    });
    const principal = {
      organizationId: ids.organizationId,
      workspaceId: ids.workspaceId,
      brainKey: "br_01J0000000000000000000000D",
    };
    await expect(
      t.query(sourcesSearch, { ...principal, query: "integrity" }),
    ).resolves.toMatchObject({
      results: [
        {
          sourceKey: committed.documentObjectKey,
          sourceRevisionKey: committed.documentRevisionKey,
          excerpt: "Drive origin integrity evidence.",
        },
      ],
    });
    await expect(
      t.query(contextGet, { ...principal, question: "integrity" }),
    ).resolves.toMatchObject({
      entries: [
        {
          sourceKey: committed.documentObjectKey,
          excerpt: "Drive origin integrity evidence.",
        },
      ],
    });
    await t.run(async (ctx) => {
      const stored = await ctx.db
        .query("documentSourceRevisions")
        .withIndex("by_organization_revision_key", (query) =>
          query
            .eq("organizationKey", "ag_01J0000000000000000000000C")
            .eq("documentRevisionKey", committed.documentRevisionKey ?? ""),
        )
        .unique();
      if (stored === null) throw new Error("expected Drive origin");
      await ctx.db.patch(stored._id, {
        normalizedText: "corrupted Drive origin",
      });
    });
    await expect(
      t.query(sourcesSearch, { ...principal, query: "integrity" }),
    ).rejects.toThrow(/origin_mismatch/);
    await expect(
      t.query(contextGet, { ...principal, question: "integrity" }),
    ).rejects.toThrow(/origin_mismatch/);
  });
});
