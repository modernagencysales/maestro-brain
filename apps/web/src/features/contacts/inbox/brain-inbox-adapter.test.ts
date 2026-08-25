import { beforeEach, describe, expect, it, vi } from 'vitest'

const brainInboxMocks = vi.hoisted(() => ({
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
  useConvexQuery: () => [],
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => unknown }) => {
    void options.queryFn()
    return { data: brainInboxMocks.queryData, isLoading: false }
  },
}))
vi.mock('#lib/auth/route-auth', () => ({
  isFixtureAuthRuntime: () => true,
  isIsolatedContractsRuntime: () => brainInboxMocks.isolatedContracts,
}))
vi.mock('#lib/headless-api', () => ({
  runIsolatedHeadlessOperation: brainInboxMocks.headless,
}))

import {
  brainInboxFixtures,
  inboxDataHooks,
  projectBrainPagesToInbox,
} from './brain-inbox-adapter'

describe('Brain pages to Starter Inbox adapter', () => {
  beforeEach(() => {
    brainInboxMocks.isolatedContracts = false
    brainInboxMocks.queryData = []
  })

  it('projects behavior data without changing the Starter row contract', () => {
    expect(
      projectBrainPagesToInbox([
        {
          _id: 'brain-page-1',
          title: 'Client positioning',
          sourceKind: 'markdown',
          updatedAt: 1_782_924_800_000,
        },
      ]),
    ).toEqual({
      notifications: [
        {
          id: 'brain-page-1',
          subjectId: 'brain-page-1',
          actorId: null,
          readAt: new Date(1_782_924_800_000),
          createdAt: new Date(1_782_924_800_000),
          type: 'update',
          subject: { name: 'Client positioning' },
          metadata: { field: 'source', value: 'markdown' },
        },
      ],
    })
  })

  it('ships a populated fake-safe Brain state', () => {
    expect(projectBrainPagesToInbox(brainInboxFixtures).notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: { name: 'Client overview' } }),
      ]),
    )
  })

  it('adapts fixture Brain pages through the complete Starter Inbox hook', () => {
    expect(inboxDataHooks.brain({ workspaceId: 'agency' })).toMatchObject({
      data: {
        notifications: expect.arrayContaining([
          expect.objectContaining({ subject: { name: 'Client overview' } }),
        ]),
      },
      isLoading: false,
    })
    expect(brainInboxMocks.headless).toHaveBeenCalled()
  })

  it('prefers isolated contract data over fixture Brain pages', () => {
    brainInboxMocks.isolatedContracts = true
    brainInboxMocks.queryData = [
      {
        _id: 'contract-page',
        title: 'Contract Brain page',
        sourceKind: 'markdown',
        updatedAt: 1_782_924_800_000,
      },
    ]

    expect(inboxDataHooks.brain({ workspaceId: 'agency' })).toMatchObject({
      data: {
        notifications: [
          expect.objectContaining({
            id: 'contract-page',
            subject: { name: 'Contract Brain page' },
          }),
        ],
      },
      isLoading: false,
    })
  })

  it('retains the untouched Starter contacts inbox adapter', () => {
    expect(inboxDataHooks.contacts({ workspaceId: 'agency' })).toMatchObject({
      data: { notifications: [] },
      isLoading: false,
    })
  })
})
