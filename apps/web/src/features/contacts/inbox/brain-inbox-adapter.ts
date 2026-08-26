import { useConvexQuery } from '@convex-dev/react-query'
import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import { useQuery } from '@tanstack/react-query'

import {
  isFixtureAuthRuntime,
  isIsolatedContractsRuntime,
} from '#lib/auth/route-auth'
import { runIsolatedHeadlessOperation } from '#lib/headless-api'

export type BrainPageSummary = Readonly<{
  _id: string
  title: string
  sourceKind: 'markdown' | 'link' | 'note'
  updatedAt: number
  parentPageId?: string | null
  favorite?: boolean
  status?: 'active' | 'archived'
  sortKey?: string
}>

export type BrainPageTreeRow = Readonly<{
  page: BrainPageSummary
  depth: number
}>

const compareBrainPages = (left: BrainPageSummary, right: BrainPageSummary) =>
  (left.sortKey ?? '').localeCompare(right.sortKey ?? '') ||
  left.title.localeCompare(right.title)

export const projectBrainPagesToTree = (
  pages: readonly BrainPageSummary[],
): readonly BrainPageTreeRow[] => {
  const activePages = pages
    .filter((page) => page.status !== 'archived')
    .toSorted(compareBrainPages)
  const pageIds = new Set(activePages.map((page) => page._id))
  const children = new Map<string | null, BrainPageSummary[]>()
  for (const page of activePages) {
    const parentId =
      page.parentPageId && pageIds.has(page.parentPageId)
        ? page.parentPageId
        : null
    children.set(parentId, [...(children.get(parentId) ?? []), page])
  }

  const rows: BrainPageTreeRow[] = []
  const visited = new Set<string>()
  const append = (page: BrainPageSummary, depth: number) => {
    if (visited.has(page._id)) return
    visited.add(page._id)
    rows.push({ page, depth })
    for (const child of children.get(page._id) ?? []) append(child, depth + 1)
  }
  for (const root of children.get(null) ?? []) append(root, 0)
  for (const orphan of activePages) append(orphan, 0)
  return rows
}

const brainPagesListRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.list,
)

export const brainPageFixtures: readonly BrainPageSummary[] = [
  {
    _id: 'brain-page-overview',
    title: 'Company overview',
    sourceKind: 'markdown',
    updatedAt: 1_782_924_800_000,
    favorite: true,
    parentPageId: null,
    sortKey: '001',
  },
  {
    _id: 'brain-page-positioning',
    title: 'Positioning and proof',
    sourceKind: 'note',
    updatedAt: 1_782_838_400_000,
    parentPageId: 'brain-page-overview',
    sortKey: '002',
  },
  {
    _id: 'brain-page-operations',
    title: 'Operating principles',
    sourceKind: 'link',
    updatedAt: 1_782_752_000_000,
    parentPageId: null,
    sortKey: '003',
  },
]

export const useBrainPages = ({ workspaceId }: { workspaceId: string }) => {
  const fixtureRuntime = isFixtureAuthRuntime()
  const isolatedContracts = isIsolatedContractsRuntime()
  const convexResult = useConvexQuery(
    brainPagesListRef,
    fixtureRuntime ? 'skip' : { workspaceId },
  )
  const contractResult = useQuery({
    queryKey: ['brain-pages', 'isolated-contracts', workspaceId],
    queryFn: () =>
      runIsolatedHeadlessOperation<readonly BrainPageSummary[]>({
        operationId: 'brain.pages.list',
      }),
    enabled: isolatedContracts,
  })
  if (fixtureRuntime) return { pages: brainPageFixtures, isLoading: false }
  if (isolatedContracts) {
    return {
      pages: contractResult.data ?? [],
      isLoading: contractResult.isLoading,
    }
  }
  return {
    pages: (convexResult ?? []) as readonly BrainPageSummary[],
    isLoading: convexResult === undefined,
  }
}
