'use client'

import { Button, Dialog, HStack, Text, VStack, toast } from '@saas-ui/react'
import { useConvexQuery } from '@convex-dev/react-query'
import { useMutation as useConvexMutation } from 'convex/react'
import * as React from 'react'

import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'

const historyRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.history,
)
const restoreRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.restore,
)

type PageRevision = Readonly<{
  _id: string
  causation: string
  title: string
  updatedAt: number
}>

export interface BrainPageHistoryDialogProps extends Omit<
  Dialog.RootProps,
  'children'
> {
  pageId: string
  updatedAt: number
  workspaceId: string
  onUpdated: (updatedAt: number) => void
}

export function BrainPageHistoryDialog({
  pageId,
  updatedAt,
  workspaceId,
  onUpdated,
  ...dialogProps
}: BrainPageHistoryDialogProps) {
  const history = useConvexQuery(historyRef, { workspaceId, pageId })
  const restore = useConvexMutation(restoreRef)
  const currentRevisionRef = React.useRef(updatedAt)
  const [restoring, setRestoring] = React.useState<number | null>(null)
  const revisions = (history ?? []) as readonly PageRevision[]
  const restoreRevision = async (revisionUpdatedAt: number) => {
    setRestoring(revisionUpdatedAt)
    try {
      const page = await restore({
        workspaceId,
        pageId,
        expectedUpdatedAt: currentRevisionRef.current,
        revisionUpdatedAt,
      })
      currentRevisionRef.current = page.updatedAt
      onUpdated(page.updatedAt)
      toast.success({ title: 'Brain page revision restored' })
      dialogProps.onOpenChange?.({ open: false })
    } catch {
      toast.error({
        title: 'Unable to restore this revision',
        description: 'Reload the page if it changed in another session.',
      })
    } finally {
      setRestoring(null)
    }
  }

  return (
    <Dialog.Root {...dialogProps}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Page history</Dialog.Title>
          <Dialog.CloseButton />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap="2">
            {revisions.map((revision, index) => (
              <HStack
                key={revision._id}
                borderWidth="1px"
                borderRadius="md"
                p="3"
              >
                <VStack align="start" gap="0" flex="1">
                  <Text fontWeight="medium">{revision.title}</Text>
                  <Text textStyle="xs" color="fg.muted">
                    {revision.causation} ·{' '}
                    {new Date(revision.updatedAt).toLocaleString()}
                  </Text>
                </VStack>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === 0 || restoring !== null}
                  loading={restoring === revision.updatedAt}
                  onClick={() => restoreRevision(revision.updatedAt)}
                >
                  {index === 0 ? 'Current' : 'Restore'}
                </Button>
              </HStack>
            ))}
            {revisions.length === 0 ? (
              <Text color="fg.muted">No revision history yet.</Text>
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
