import { afterEach, describe, expect, it, vi } from 'vitest'

const brainMocks = vi.hoisted(() => ({
  convexData: [] as unknown[],
  fixtureRuntime: true,
  headless: vi.fn(async () => []),
  isolatedContracts: false,
  queryData: [] as Array<{
    _id: string
    title: string
    sourceKind: 'markdown' | 'link' | 'note'
    updatedAt: number
  }>,
}))

vi.mock('@convex-dev/react-query', () => ({
  useConvexQuery: () => brainMocks.convexData,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => unknown }) => {
    void options.queryFn()
    return { data: brainMocks.queryData, isLoading: false }
  },
}))
vi.mock('#lib/auth/route-auth', () => ({
  isFixtureAuthRuntime: () => brainMocks.fixtureRuntime,
  isIsolatedContractsRuntime: () => brainMocks.isolatedContracts,
}))
vi.mock('#lib/headless-api', () => ({
  runIsolatedHeadlessOperation: brainMocks.headless,
}))

import {
  brainEvidenceRevisionRouteId,
  brainEvidenceRouteId,
  brainPageFixtures,
  parseBrainEvidenceRevisionRouteId,
  parseBrainEvidenceRouteId,
  projectBrainPagesToTree,
  useBrainEvidence,
  useBrainPages,
} from './brain-inbox-adapter'

describe('Brain page-tree adapter', () => {
  afterEach(() => {
    brainMocks.convexData = []
    brainMocks.fixtureRuntime = true
    brainMocks.isolatedContracts = false
  })

  it('round-trips current evidence through a route-safe id', () => {
    const entryKey = 'slack:C01:message:1787920000.000100'
    expect(parseBrainEvidenceRouteId(brainEvidenceRouteId(entryKey))).toBe(
      entryKey,
    )
    expect(parseBrainEvidenceRouteId('page-id')).toBeUndefined()
    expect(parseBrainEvidenceRouteId('evidence:%E0%A4%A')).toBeUndefined()
  })

  it('round-trips an exact immutable evidence revision through a route-safe id', () => {
    const sourceKey = 'slack:C01:message:1787920000.000100'
    const revisionKey = 'edited:1787920100.000200'
    expect(
      parseBrainEvidenceRevisionRouteId(
        brainEvidenceRevisionRouteId(sourceKey, revisionKey),
      ),
    ).toEqual({ sourceKey, revisionKey })
    expect(parseBrainEvidenceRevisionRouteId('page-id')).toBeUndefined()
    expect(
      parseBrainEvidenceRevisionRouteId('evidence-revision:missing-separator'),
    ).toBeUndefined()
  })

  it('projects parent-child pages in stable tree order', () => {
    const rows = projectBrainPagesToTree([
      {
        _id: 'child',
        title: 'Child',
        sourceKind: 'note',
        updatedAt: 2,
        parentPageId: 'root',
        sortKey: '002',
      },
      {
        _id: 'root',
        title: 'Root',
        sourceKind: 'markdown',
        updatedAt: 1,
        parentPageId: null,
        sortKey: '001',
      },
    ])
    expect(rows.map(({ page, depth }) => [page._id, depth])).toEqual([
      ['root', 0],
      ['child', 1],
    ])
  })

  it('keeps orphans visible, avoids cycles, and excludes archived pages', () => {
    const rows = projectBrainPagesToTree([
      {
        _id: 'orphan',
        title: 'Orphan',
        sourceKind: 'link',
        updatedAt: 1,
        parentPageId: 'missing',
      },
      {
        _id: 'cycle-a',
        title: 'Cycle A',
        sourceKind: 'note',
        updatedAt: 1,
        parentPageId: 'cycle-b',
      },
      {
        _id: 'cycle-b',
        title: 'Cycle B',
        sourceKind: 'note',
        updatedAt: 1,
        parentPageId: 'cycle-a',
      },
      {
        _id: 'archived',
        title: 'Archived',
        sourceKind: 'markdown',
        updatedAt: 1,
        status: 'archived',
      },
    ])
    expect(rows.map(({ page }) => page._id)).toEqual([
      'orphan',
      'cycle-a',
      'cycle-b',
    ])
  })

  it('returns direct Brain pages instead of notification-shaped contacts', () => {
    expect(useBrainPages({ workspaceId: 'agency' })).toMatchObject({
      pages: expect.arrayContaining([
        expect.objectContaining({ title: 'Company overview' }),
      ]),
      isLoading: false,
    })
    expect(brainPageFixtures[0]).not.toHaveProperty('subject')
    expect(brainMocks.headless).toHaveBeenCalled()
  })

  it('makes synced Slack evidence visible in the fixture Brain', () => {
    expect(useBrainEvidence({ workspaceId: 'agency' })).toMatchObject({
      evidence: [
        expect.objectContaining({
          provider: 'slack',
          title: 'Slack · #company-context · U01',
        }),
      ],
      isLoading: false,
    })
  })

  it('keeps curated page evidence out of the synced-source list', () => {
    brainMocks.fixtureRuntime = false
    brainMocks.convexData = [
      {
        entryKey: 'brain-page:overview:revision:1',
        sourceKey: 'brain-page:overview',
        revisionKey: '1',
        provider: 'brain_page',
        title: 'Company overview',
        excerpt: 'Curated context',
        sourceModifiedAt: 1,
        observedAt: 1,
      },
      {
        entryKey: 'slack:C01:message:1:revision:1',
        sourceKey: 'slack:C01:message:1',
        revisionKey: '1',
        provider: 'slack',
        title: 'Slack evidence',
        excerpt: 'Synced context',
        sourceModifiedAt: 1,
        observedAt: 1,
      },
    ]

    expect(useBrainEvidence({ workspaceId: 'agency' })).toMatchObject({
      evidence: [expect.objectContaining({ provider: 'slack' })],
      isLoading: false,
    })
  })

  it('prefers isolated contract pages over fixture pages', () => {
    brainMocks.isolatedContracts = true
    brainMocks.queryData = [
      {
        _id: 'contract-page',
        title: 'Contract Brain page',
        sourceKind: 'markdown',
        updatedAt: 1_782_924_800_000,
      },
    ]

    expect(useBrainPages({ workspaceId: 'agency' })).toMatchObject({
      pages: [expect.objectContaining({ title: 'Contract Brain page' })],
      isLoading: false,
    })
  })
})
