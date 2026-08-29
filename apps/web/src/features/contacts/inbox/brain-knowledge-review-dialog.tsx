'use client'

import { useConvexQuery } from '@convex-dev/react-query'
import {
  Badge,
  Button,
  Dialog,
  HStack,
  Text,
  VStack,
  toast,
} from '@saas-ui/react'
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
    limit: 25,
  }) ?? []) as readonly KnowledgeCandidate[]
  const review = useConvexMutation(reviewCandidateRef)
  const queueExtraction = useConvexMutation(queueExtractionRef)
  const [reviewing, setReviewing] = React.useState<string | null>(null)
  const [queueing, setQueueing] = React.useState(false)

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
      await review({
        workspaceId,
        candidateReceiptKey: candidate.candidateReceiptKey,
        expectedReviewRevision: candidate.reviewRevision,
        idempotencyKey: `brain-review-ui:${candidate.candidateReceiptKey}:${candidate.reviewRevision}:${action}`,
        action,
      })
      toast.success({
        title:
          action === 'accept'
            ? 'Added to company truth'
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
                    Accept as truth
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
