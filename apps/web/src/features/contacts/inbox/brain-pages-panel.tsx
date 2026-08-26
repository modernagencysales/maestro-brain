'use client'

import { HStack, Heading, Text, VStack } from '@chakra-ui/react'
import { IconButton, Tooltip } from '@saas-ui/react'
import { FaFile, FaFileLines, FaLink } from 'react-icons/fa6'
import { LuChevronRight, LuPlus, LuStar } from 'react-icons/lu'

import * as GridList from '#components/ui/grid-list/grid-list'
import { IconBadge } from '#components/ui/icon-badge/icon-badge'

import type { BrainPageTreeRow } from './brain-inbox-adapter'

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

export function BrainPagesPanel({
  activePageId,
  onCreate,
  onSelect,
  rows,
}: {
  activePageId?: string
  onCreate: () => void
  onSelect: (pageId: string) => void
  rows: readonly BrainPageTreeRow[]
}) {
  return (
    <VStack align="stretch" gap="0" height="100%">
      <HStack px="4" py="3" borderBottomWidth="1px">
        <VStack align="start" gap="0" flex="1">
          <Heading as="h2" textStyle="md">
            Pages
          </Heading>
          <Text color="fg.muted" textStyle="xs">
            {rows.length} company context pages
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
      </HStack>
      <GridList.Root interactive overflowY="auto" flex="1" pb="0">
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
    </VStack>
  )
}
