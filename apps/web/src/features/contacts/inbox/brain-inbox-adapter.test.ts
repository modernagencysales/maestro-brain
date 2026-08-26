import { describe, expect, it, vi } from 'vitest'

const brainMocks = vi.hoisted(() => ({
  headless: vi.fn(async () => []),
}))

vi.mock('@convex-dev/react-query', () => ({ useConvexQuery: () => [] }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => unknown }) => {
    void options.queryFn()
    return { data: [], isLoading: false }
  },
}))
vi.mock('#lib/auth/route-auth', () => ({
  isFixtureAuthRuntime: () => true,
  isIsolatedContractsRuntime: () => false,
}))
vi.mock('#lib/headless-api', () => ({
  runIsolatedHeadlessOperation: brainMocks.headless,
}))

import {
  brainPageFixtures,
  projectBrainPagesToTree,
  useBrainPages,
} from './brain-inbox-adapter'

describe('Brain page-tree adapter', () => {
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
})
