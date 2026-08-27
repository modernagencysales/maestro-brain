'use client'

import { Box, HStack, Heading, Link, Text, VStack } from '@chakra-ui/react'

export type BrainEvidenceDetail = Readonly<{
  sourceKey: string
  revisionKey: string
  provider: 'brain_page' | 'slack' | 'google_drive' | 'hubspot' | 'transcript'
  scopeKey: string
  title: string
  markdown: string
  locator?: string
  sourceModifiedAt: number
  observedAt: number
  tombstone: boolean
}>

const MetadataRow = ({ label, value }: { label: string; value: string }) => (
  <HStack align="start" justify="space-between" gap="4">
    <Text textStyle="xs" color="fg.muted">
      {label}
    </Text>
    <Text textStyle="xs" textAlign="end" wordBreak="break-all">
      {value}
    </Text>
  </HStack>
)

export function BrainEvidenceProvenanceRail({
  evidence,
}: {
  evidence: BrainEvidenceDetail
}) {
  return (
    <Box aria-label="Synced source context" height="100%" overflowY="auto">
      <HStack px="4" py="3" borderBottomWidth="1px">
        <Heading as="h2" textStyle="md">
          Synced source
        </Heading>
      </HStack>
      <VStack align="stretch" gap="3" p="4">
        <MetadataRow label="Provider" value={evidence.provider.replace('_', ' ')} />
        <MetadataRow label="Source key" value={evidence.sourceKey} />
        <MetadataRow label="Revision" value={evidence.revisionKey} />
        <MetadataRow label="Scope" value={evidence.scopeKey} />
        <MetadataRow
          label="Source updated"
          value={new Date(evidence.sourceModifiedAt).toLocaleString()}
        />
        <MetadataRow
          label="Brain observed"
          value={new Date(evidence.observedAt).toLocaleString()}
        />
        {evidence.locator ? (
          <Link href={evidence.locator} textStyle="xs" wordBreak="break-all">
            Open original source
          </Link>
        ) : null}
        <Text textStyle="xs" color="fg.muted">
          Synced sources are read-only evidence. Promote durable conclusions into
          a company page so the team can edit and maintain them.
        </Text>
      </VStack>
    </Box>
  )
}
