import { useConvexQuery } from '@convex-dev/react-query'
import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import type { NotificationDTO } from '@workspace/api/types'
import { useQuery } from '@tanstack/react-query'

import { api } from '#lib/trpc/react'
import {
  isFixtureAuthRuntime,
  isIsolatedContractsRuntime,
} from '#lib/auth/route-auth'
import { runIsolatedHeadlessOperation } from '#lib/headless-api'

export type BrainInboxPage = Readonly<{
  _id: string
  title: string
  sourceKind: 'markdown' | 'link' | 'note'
  updatedAt: number
}>

export const projectBrainPagesToInbox = (
  pages: readonly BrainInboxPage[],
): { notifications: NotificationDTO[] } => ({
  notifications: pages.map((page) => ({
    id: page._id,
    subjectId: page._id,
    actorId: null,
    readAt: new Date(page.updatedAt),
    createdAt: new Date(page.updatedAt),
    type: 'update',
    subject: { name: page.title },
    metadata: { field: 'source', value: page.sourceKind },
  })),
})

const brainPagesListRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.list,
)

export const brainInboxFixtures: readonly BrainInboxPage[] = [
  {
    _id: 'brain-page-overview',
    title: 'Client overview',
    sourceKind: 'markdown',
    updatedAt: 1_782_924_800_000,
  },
  {
    _id: 'brain-page-positioning',
    title: 'Positioning and proof',
    sourceKind: 'note',
    updatedAt: 1_782_838_400_000,
  },
]

const useBrainInbox = ({ workspaceId }: { workspaceId: string }) => {
  const fixtureRuntime = isFixtureAuthRuntime()
  const isolatedContracts = isIsolatedContractsRuntime()
  const convexResult = useConvexQuery(
    brainPagesListRef,
    fixtureRuntime ? 'skip' : { workspaceId },
  )
  const contractResult = useQuery({
    queryKey: ['brain-pages', 'isolated-contracts', workspaceId],
    queryFn: () =>
      runIsolatedHeadlessOperation<readonly BrainInboxPage[]>({
        operationId: 'brain.pages.list',
    }),
    enabled: isolatedContracts,
  })
  if (fixtureRuntime) {
    return {
      data: projectBrainPagesToInbox(brainInboxFixtures),
      isLoading: false,
    }
  }
  if (isolatedContracts) {
    return {
      data: projectBrainPagesToInbox(contractResult.data ?? []),
      isLoading: contractResult.isLoading,
    }
  }
  return {
    data: projectBrainPagesToInbox(convexResult ?? []),
    isLoading: convexResult === undefined,
  }
}

const useContactsInbox = ({ workspaceId }: { workspaceId: string }) =>
  api.notifications.inbox.useQuery({ workspaceId })

export const inboxDataHooks = {
  brain: useBrainInbox,
  contacts: useContactsInbox,
} as const
