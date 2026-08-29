'use client'

import { Box, HStack, Heading, Text, VStack } from '@chakra-ui/react'
import { IconButton, Tooltip } from '@saas-ui/react'
import { FaFile, FaFileLines, FaLink } from 'react-icons/fa6'
import {
  LuChevronRight,
  LuDatabase,
  LuListChecks,
  LuMessageSquare,
  LuPlus,
  LuStar,
} from 'react-icons/lu'

import * as GridList from '#components/ui/grid-list/grid-list'
import { IconBadge } from '#components/ui/icon-badge/icon-badge'
import { useCurrentWorkspace } from '#features/common/hooks/use-current-workspace'

import {
  brainEvidenceRouteId,
  parseBrainEvidenceRouteId,
  useBrainEvidence,
  type BrainEvidenceSummary,
  type BrainPageTreeRow,
} from './brain-inbox-adapter'

const pageIcon = (sourceKind: BrainPageTreeRow['page']['sourceKind']) => {
  if (sourceKind === 'link') return <FaLink />
  if (sourceKind === 'note') return <FaFileLines />
  return <FaFile />
}

const pageIconColor = {
  link: 'purple.500',
  markdown: 'blue.500',
  note: 'orange.500',
} as const

export const brainPageModifiedLabel = (updatedAt: number) =>
  new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(updatedAt)

// The Pro SplitPage ships its layout through a Pro-only slot recipe. The
// canonical app preset does not register that recipe, so scope the packaged
// layout contract to the Brain composition instead of changing pinned files.
const brainSplitPageLayout = `
[data-testid='brain-split-page'] {
  display: flex;
  flex: 1 1 0%;
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
  flex-direction: row;
}

[data-testid='brain-split-page'] > :last-child {
  display: flex;
  flex: 1 1 0%;
  width: auto;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
`

export function BrainPagesPanel({
  activePageId,
  evidence: evidenceOverride,
  onCreate,
  onReview,
  onSelect,
  rows,
}: {
  activePageId?: string
  evidence?: readonly BrainEvidenceSummary[]
  onCreate: () => void
  onReview?: () => void
  onSelect: (pageId: string) => void
  rows: readonly BrainPageTreeRow[]
}) {
  const [workspace] = useCurrentWorkspace()
  const { evidence: loadedEvidence } = useBrainEvidence({
    workspaceId: workspace.id,
  })
  const evidence = evidenceOverride ?? loadedEvidence
  const activeEvidenceEntryKey = activePageId
    ? parseBrainEvidenceRouteId(activePageId)
    : undefined
  return (
    <>
      <style>{brainSplitPageLayout}</style>
      <VStack
        align="stretch"
        gap="0"
        height="100%"
        minH="0"
        overflow="hidden"
        width="100%"
      >
      <HStack px="4" py="3" borderBottomWidth="1px">
        <VStack align="start" gap="0" flex="1">
          <Heading as="h2" textStyle="md">
            Pages
          </Heading>
          <Text color="fg.muted" textStyle="xs">
            {rows.length} pages · {evidence.length} synced sources
          </Text>
        </VStack>
        <Tooltip content="New Brain page">
          <IconButton
            aria-label="New Brain page"
            size="sm"
            variant="ghost"
            onClick={onCreate}
          >
            <LuPlus />
          </IconButton>
        </Tooltip>
        <Tooltip content="Review grounded knowledge">
          <IconButton
            aria-label="Review grounded knowledge"
            size="sm"
            variant="ghost"
            onClick={onReview}
          >
            <LuListChecks />
          </IconButton>
        </Tooltip>
      </HStack>
      <Box overflowY="auto" flex="1" minH="0">
        <HStack px="4" py="2" bg="bg.subtle" borderBottomWidth="1px">
          <Heading as="h3" textStyle="xs" textTransform="uppercase">
            Company pages
          </Heading>
        </HStack>
        <GridList.Root interactive pb="0">
          {rows.map(({ page, depth }) => {
          const selected = page._id === activePageId
          return (
            <GridList.Item
              key={page._id}
              aria-current={selected ? 'page' : undefined}
              bg={selected ? 'bg.muted' : undefined}
              borderBottomWidth="1px"
              ps={String(depth * 4 + 3)}
              pe="3"
              py="2.5"
              onClick={() => onSelect(page._id)}
            >
              <GridList.Cell color="fg.muted" width="3">
                {depth > 0 ? <LuChevronRight /> : null}
              </GridList.Cell>
              <GridList.Cell>
                <IconBadge color={pageIconColor[page.sourceKind]}>
                  {pageIcon(page.sourceKind)}
                </IconBadge>
              </GridList.Cell>
              <GridList.Cell flex="1" minW="0">
                <VStack align="start" gap="0" lineHeight="1.4">
                  <HStack width="100%" gap="1">
                    <Heading
                      as="h3"
                      size="sm"
                      fontWeight="medium"
                      truncate
                    >
                      {page.title}
                    </Heading>
                    {page.favorite ? (
                      <LuStar aria-label="Favorite page" fill="currentColor" />
                    ) : null}
                  </HStack>
                  <Text color="fg.muted" textStyle="xs">
                    {page.sourceKind} • {brainPageModifiedLabel(page.updatedAt)}
                  </Text>
                </VStack>
              </GridList.Cell>
            </GridList.Item>
          )
          })}
        </GridList.Root>
        <HStack
          px="4"
          py="2"
          bg="bg.subtle"
          borderTopWidth="1px"
          borderBottomWidth="1px"
        >
          <Heading as="h3" textStyle="xs" textTransform="uppercase">
            Synced sources
          </Heading>
        </HStack>
        {evidence.length === 0 ? (
          <VStack align="start" gap="1" px="4" py="4">
            <Text textStyle="sm" fontWeight="medium">
              No synced sources yet
            </Text>
            <Text color="fg.muted" textStyle="xs">
              Connect Slack, Drive, or HubSpot and sync an approved scope.
            </Text>
          </VStack>
        ) : (
          <GridList.Root interactive pb="0">
            {evidence.map((source) => {
              const selected = source.entryKey === activeEvidenceEntryKey
              return (
                <GridList.Item
                  key={source.entryKey}
                  aria-current={selected ? 'page' : undefined}
                  bg={selected ? 'bg.muted' : undefined}
                  borderBottomWidth="1px"
                  px="3"
                  py="2.5"
                  onClick={() => onSelect(brainEvidenceRouteId(source.entryKey))}
                >
                  <GridList.Cell>
                    <IconBadge
                      color={source.provider === 'slack' ? 'purple.500' : 'teal.500'}
                    >
                      {source.provider === 'slack' ? (
                        <LuMessageSquare />
                      ) : (
                        <LuDatabase />
                      )}
                    </IconBadge>
                  </GridList.Cell>
                  <GridList.Cell flex="1" minW="0">
                    <VStack align="start" gap="0" lineHeight="1.4">
                      <Heading as="h4" size="sm" fontWeight="medium" truncate>
                        {source.title}
                      </Heading>
                      <Text color="fg.muted" textStyle="xs" truncate width="100%">
                        {source.excerpt}
                      </Text>
                      <Text color="fg.muted" textStyle="xs">
                        {source.provider.replace('_', ' ')} ·{' '}
                        {brainPageModifiedLabel(source.sourceModifiedAt)}
                      </Text>
                    </VStack>
                  </GridList.Cell>
                </GridList.Item>
              )
            })}
          </GridList.Root>
        )}
        </Box>
      </VStack>
    </>
  )
}
