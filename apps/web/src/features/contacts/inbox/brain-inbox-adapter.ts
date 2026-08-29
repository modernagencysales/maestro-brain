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

export type BrainEvidenceSummary = Readonly<{
  entryKey: string
  sourceKey: string
  revisionKey: string
  provider: 'brain_page' | 'slack' | 'google_drive' | 'hubspot' | 'transcript'
  title: string
  excerpt: string
  locator?: string
  sourceModifiedAt: number
  observedAt: number
}>

const evidenceRoutePrefix = 'evidence:'
const evidenceRevisionRoutePrefix = 'evidence-revision:'

export type BrainEvidenceRevisionRoute = Readonly<{
  sourceKey: string
  revisionKey: string
}>

export const brainEvidenceRouteId = (entryKey: string) =>
  `${evidenceRoutePrefix}${encodeURIComponent(entryKey)}`

export const parseBrainEvidenceRouteId = (routeId: string) => {
  if (!routeId.startsWith(evidenceRoutePrefix)) return undefined
  try {
    const entryKey = decodeURIComponent(routeId.slice(evidenceRoutePrefix.length))
    return entryKey.length > 0 ? entryKey : undefined
  } catch {
    return undefined
  }
}

export const brainEvidenceRevisionRouteId = (
  sourceKey: string,
  revisionKey: string,
) =>
  `${evidenceRevisionRoutePrefix}${encodeURIComponent(sourceKey)}:${encodeURIComponent(revisionKey)}`

export const parseBrainEvidenceRevisionRouteId = (
  routeId: string,
): BrainEvidenceRevisionRoute | undefined => {
  if (!routeId.startsWith(evidenceRevisionRoutePrefix)) return undefined
  const encoded = routeId.slice(evidenceRevisionRoutePrefix.length)
  const separator = encoded.indexOf(':')
  if (separator < 1 || separator === encoded.length - 1) return undefined
  try {
    const sourceKey = decodeURIComponent(encoded.slice(0, separator))
    const revisionKey = decodeURIComponent(encoded.slice(separator + 1))
    return sourceKey.length > 0 && revisionKey.length > 0
      ? { sourceKey, revisionKey }
      : undefined
  } catch {
    return undefined
  }
}

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
const brainEvidenceListRef = getFunctionReference(
  templateConfectRefs.public.brain.evidence.listCurrent,
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

export const brainEvidenceFixtures: readonly BrainEvidenceSummary[] = [
  {
    entryKey: 'slack:C01:message:1787920000.000100:revision:1787920000.000100',
    sourceKey: 'slack:C01:message:1787920000.000100',
    revisionKey: '1787920000.000100',
    provider: 'slack',
    title: 'Slack · #company-context · U01',
    excerpt: 'Our approved positioning is focused on modern agency sales teams.',
    locator: 'slack://channel/C01/message/1787920000.000100',
    sourceModifiedAt: 1_787_920_000_000,
    observedAt: 1_787_920_060_000,
  },
]

export const useBrainPages = ({ workspaceId }: { workspaceId: string }) => {
  const isolatedContracts = isIsolatedContractsRuntime()
  const fixtureRuntime = isFixtureAuthRuntime() && !isolatedContracts
  const convexResult = useConvexQuery(
    brainPagesListRef,
    fixtureRuntime || isolatedContracts ? 'skip' : { workspaceId },
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

export const useBrainEvidence = ({ workspaceId }: { workspaceId: string }) => {
  const isolatedContracts = isIsolatedContractsRuntime()
  const fixtureRuntime = isFixtureAuthRuntime() && !isolatedContracts
  const evidence = useConvexQuery(
    brainEvidenceListRef,
    fixtureRuntime || isolatedContracts
      ? 'skip'
      : { workspaceId, limit: 200 },
  )
  if (fixtureRuntime)
    return { evidence: brainEvidenceFixtures, isLoading: false }
  if (isolatedContracts)
    return { evidence: [] as readonly BrainEvidenceSummary[], isLoading: false }
  return {
    evidence: ((evidence ?? []) as readonly BrainEvidenceSummary[]).filter(
      ({ provider }) => provider !== 'brain_page',
    ),
    isLoading: evidence === undefined,
  }
}
