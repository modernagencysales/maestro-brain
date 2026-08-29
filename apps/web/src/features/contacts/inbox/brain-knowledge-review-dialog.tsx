'use client'

import { useConvexQuery } from '@convex-dev/react-query'
import {
  Badge,
  Button,
  Dialog,
  HStack,
  Text,
  Textarea,
  VStack,
  toast,
} from '@saas-ui/react'
import { NativeSelect } from '@chakra-ui/react'
import { useMutation as useConvexMutation } from 'convex/react'
import * as React from 'react'

import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'

const listCandidatesRef = getFunctionReference(
  templateConfectRefs.public.capabilities.reviewBrainKnowledgeCandidate
    .listBrainKnowledgeCandidates,
)
const reviewCandidateRef = getFunctionReference(
  templateConfectRefs.public.capabilities.reviewBrainKnowledgeCandidate
    .reviewBrainKnowledgeCandidate,
)
const queueExtractionRef = getFunctionReference(
  templateConfectRefs.public.capabilities.extractBrainKnowledgeCandidates
    .queueBrainKnowledgeExtraction,
)

type KnowledgeCandidate = Readonly<{
  candidateReceiptKey: string
  body: string
  epistemics: 'factual' | 'subjective'
  tags: readonly string[]
  extractionConfidence: number
  reviewRevision: number
  sourceTitle: string
  sourceProvider: string
  evidence: readonly Readonly<{ quote: string }>[]
}>

const stableTextHash = (value: string) => {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export const acceptedClaimPageMarkdown = (input: {
  body: string
  citationKey: string
  sourceProvider: string
  sourceTitle: string
  quote: string
}) =>
  `${input.body}\n\n> “${input.quote}”\n> Source: ${input.sourceProvider} · ${input.sourceTitle} · ${input.citationKey}`

export interface BrainKnowledgeReviewDialogProps extends Omit<
  Dialog.RootProps,
  'children'
> {
  workspaceId: string
}

export function BrainKnowledgeReviewDialog({
  workspaceId,
  ...dialogProps
}: BrainKnowledgeReviewDialogProps) {
  const candidates = (useConvexQuery(listCandidatesRef, {
    workspaceId,
    state: 'unreviewed',
    limit: 5,
  }) ?? []) as readonly KnowledgeCandidate[]
  const review = useConvexMutation(reviewCandidateRef)
  const queueExtraction = useConvexMutation(queueExtractionRef)
  const [reviewing, setReviewing] = React.useState<string | null>(null)
  const [queueing, setQueueing] = React.useState(false)
  const [edits, setEdits] = React.useState<Record<string, string>>({})
  const [reviewHorizonDays, setReviewHorizonDays] = React.useState(90)

  const queueCurrentEvidence = async () => {
    setQueueing(true)
    try {
      const result = await queueExtraction({ workspaceId, limit: 25 })
      toast.success({
        title:
          result.scheduledCount > 0
            ? `Queued ${result.scheduledCount} evidence sources`
            : 'Evidence is already processed',
      })
    } catch {
      toast.error({
        title: 'Unable to queue evidence extraction',
        description:
          'Live generation may be disabled or another extraction may be running.',
      })
    } finally {
      setQueueing(false)
    }
  }

  const submit = async (
    candidate: KnowledgeCandidate,
    action: 'accept' | 'reject',
  ) => {
    setReviewing(candidate.candidateReceiptKey)
    try {
      const editedBody = edits[candidate.candidateReceiptKey]?.trim()
      const reviewAction =
        action === 'accept' &&
        editedBody !== undefined &&
        editedBody !== candidate.body
          ? 'edit_and_accept'
          : action
      const result = await review({
        workspaceId,
        candidateReceiptKey: candidate.candidateReceiptKey,
        expectedReviewRevision: candidate.reviewRevision,
        idempotencyKey: `brain-review-ui:${stableTextHash(candidate.candidateReceiptKey)}:${candidate.reviewRevision}:${reviewAction}:${stableTextHash(editedBody ?? candidate.body)}`,
        action: reviewAction,
        ...(reviewAction === 'edit_and_accept'
          ? { body: editedBody ?? candidate.body }
          : {}),
        ...(action === 'accept' ? { reviewHorizonDays } : {}),
      })
      if (action === 'accept' && result.citationKey && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(
            acceptedClaimPageMarkdown({
              body: editedBody ?? candidate.body,
              citationKey: result.citationKey,
              sourceProvider: candidate.sourceProvider,
              sourceTitle: candidate.sourceTitle,
              quote: candidate.evidence[0]?.quote ?? '',
            }),
          )
        } catch {
          // Acceptance is durable even if this browser blocks clipboard access.
        }
      }
      toast.success({
        title:
          action === 'accept'
            ? 'Added to company truth and copied for a Page'
            : 'Candidate rejected',
      })
    } catch {
      toast.error({
        title: 'Unable to review this candidate',
        description: 'Reload if another reviewer changed it first.',
      })
    } finally {
      setReviewing(null)
    }
  }

  const rejectVisible = async () => {
    for (const candidate of candidates) {
      await submit(candidate, 'reject')
    }
  }

  return (
    <Dialog.Root size="xl" {...dialogProps}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Review company knowledge</Dialog.Title>
          <Dialog.CloseButton />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap="3">
            <HStack justify="space-between" gap="3">
              <Text color="fg.muted" textStyle="sm">
                Turn current synced evidence into grounded review candidates.
              </Text>
              <Button
                size="sm"
                variant="outline"
                loading={queueing}
                onClick={queueCurrentEvidence}
              >
                Extract new evidence
              </Button>
            </HStack>
            <HStack justify="flex-end" gap="2">
              <Text textStyle="xs" color="fg.muted">
                Recheck accepted truth after
              </Text>
              <NativeSelect.Root size="sm" width="32">
                <NativeSelect.Field
                  aria-label="Review horizon"
                  value={String(reviewHorizonDays)}
                  onChange={(event) =>
                    setReviewHorizonDays(Number(event.target.value))
                  }
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </HStack>
            {candidates.length > 1 ? (
              <HStack justify="flex-end">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={reviewing !== null}
                  onClick={rejectVisible}
                >
                  Reject visible candidates
                </Button>
              </HStack>
            ) : null}
            {candidates.map((candidate) => (
              <VStack
                key={candidate.candidateReceiptKey}
                align="stretch"
                gap="3"
                borderWidth="1px"
                borderRadius="lg"
                p="4"
              >
                <HStack gap="2" wrap="wrap">
                  <Badge>{candidate.epistemics}</Badge>
                  <Badge colorPalette="accent">
                    {Math.round(candidate.extractionConfidence * 100)}% grounded
                  </Badge>
                  {candidate.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </HStack>
                <Text fontWeight="medium">{candidate.body}</Text>
                <Textarea
                  aria-label={`Edit candidate ${candidate.candidateReceiptKey}`}
                  value={edits[candidate.candidateReceiptKey] ?? candidate.body}
                  maxLength={500}
                  autoresize
                  onChange={(event) =>
                    setEdits((current) => ({
                      ...current,
                      [candidate.candidateReceiptKey]: event.target.value,
                    }))
                  }
                />
                <VStack align="stretch" gap="1" bg="bg.subtle" p="3">
                  <Text textStyle="xs" color="fg.muted">
                    {candidate.sourceProvider} · {candidate.sourceTitle}
                  </Text>
                  <Text textStyle="sm">“{candidate.evidence[0]?.quote}”</Text>
                </VStack>
                <HStack justify="flex-end">
                  <Button
                    variant="ghost"
                    disabled={reviewing !== null}
                    onClick={() => submit(candidate, 'reject')}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    colorPalette="accent"
                    loading={reviewing === candidate.candidateReceiptKey}
                    disabled={reviewing !== null}
                    onClick={() => submit(candidate, 'accept')}
                  >
                    Accept & copy for Page
                  </Button>
                </HStack>
              </VStack>
            ))}
            {candidates.length === 0 ? (
              <VStack py="10" gap="1">
                <Text fontWeight="medium">Review queue is clear</Text>
                <Text color="fg.muted" textStyle="sm">
                  New grounded candidates appear after evidence extraction.
                </Text>
              </VStack>
            ) : null}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.ActionTrigger asChild>
            <Button variant="ghost">Close</Button>
          </Dialog.ActionTrigger>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
