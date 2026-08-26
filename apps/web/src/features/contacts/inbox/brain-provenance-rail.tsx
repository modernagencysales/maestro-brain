'use client'

import {
  Box,
  Collapsible,
  HStack,
  Heading,
  IconButton,
  Text,
  VStack,
} from '@chakra-ui/react'
import {
  LuChevronDown,
  LuDatabase,
  LuFileClock,
  LuGitCommitHorizontal,
} from 'react-icons/lu'

type BrainRailPage = Readonly<{
  _id: string
  sourceKind: 'markdown' | 'link' | 'note'
  status?: 'active' | 'archived'
  updatedAt: number
}>

export type BrainPageRevisionSummary = Readonly<{
  _id: string
  causation: string
  title: string
  updatedAt: number
}>

export const brainRailSectionLabels = [
  'Provenance',
  'History',
  'Source',
] as const

function RailSection({
  children,
  icon,
  title,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  title: (typeof brainRailSectionLabels)[number]
}) {
  return (
    <Collapsible.Root defaultOpen borderBottomWidth="1px">
      <Collapsible.Trigger asChild>
        <HStack as="button" width="100%" px="4" py="3" textAlign="start">
          {icon}
          <Heading as="h3" size="sm" flex="1">
            {title}
          </Heading>
          <IconButton
            as="span"
            aria-label={'Toggle ' + title}
            size="xs"
            variant="ghost"
          >
            <LuChevronDown />
          </IconButton>
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content px="4" pb="4">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack align="start" justify="space-between" gap="4">
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
      <Text textStyle="xs" textAlign="end">
        {value}
      </Text>
    </HStack>
  )
}

export function BrainProvenanceRail({
  page,
  revisions,
}: {
  page: BrainRailPage
  revisions: readonly BrainPageRevisionSummary[]
}) {
  return (
    <Box aria-label="Page context" height="100%" overflowY="auto">
      <HStack px="4" py="3" borderBottomWidth="1px">
        <Heading as="h2" textStyle="md">
          Page context
        </Heading>
      </HStack>
      <RailSection title="Provenance" icon={<LuGitCommitHorizontal />}>
        <VStack align="stretch" gap="2">
          <MetadataRow label="Page ID" value={page._id} />
          <MetadataRow label="State" value={page.status ?? 'active'} />
          <MetadataRow
            label="Updated"
            value={new Date(page.updatedAt).toLocaleString()}
          />
        </VStack>
      </RailSection>
      <RailSection title="History" icon={<LuFileClock />}>
        <VStack align="stretch" gap="3">
          {revisions.slice(0, 6).map((revision, index) => (
            <VStack key={revision._id} align="start" gap="0">
              <Text textStyle="sm" fontWeight="medium">
                {index === 0 ? 'Current revision' : revision.title}
              </Text>
              <Text textStyle="xs" color="fg.muted">
                {revision.causation} ·{' '}
                {new Date(revision.updatedAt).toLocaleString()}
              </Text>
            </VStack>
          ))}
          {revisions.length === 0 ? (
            <Text textStyle="sm" color="fg.muted">
              No revision history yet.
            </Text>
          ) : null}
        </VStack>
      </RailSection>
      <RailSection title="Source" icon={<LuDatabase />}>
        <VStack align="stretch" gap="2">
          <MetadataRow label="Kind" value={page.sourceKind} />
          <Text textStyle="xs" color="fg.muted">
            This page is backed by the current Brain page contract. Connected
            source evidence remains available through citations and revisions.
          </Text>
        </VStack>
      </RailSection>
    </Box>
  )
}
