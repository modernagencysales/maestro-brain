'use client'

import { Button, Dialog, toast } from '@saas-ui/react'
import { useConvexQuery } from '@convex-dev/react-query'
import { useMutation as useConvexMutation } from 'convex/react'
import { z } from 'zod'

import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import { Form, useAppForm } from '@workspace/ui/form'

const listPagesRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.list,
)
const renamePageRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.rename,
)
const movePageRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.move,
)

const ROOT_PAGE = '__root__'
const schema = z.object({
  title: z.string().min(1).max(160),
  parentPageId: z.string(),
})

type OrganizePage = Readonly<{
  _id: string
  title: string
  parentPageId?: string | null
  sortKey?: string
  updatedAt: number
}>

export interface BrainPageOrganizeDialogProps extends Omit<
  Dialog.RootProps,
  'children'
> {
  page: OrganizePage
  workspaceId: string
  onUpdated: (updatedAt: number) => void
}

export function BrainPageOrganizeDialog({
  page,
  workspaceId,
  onUpdated,
  ...dialogProps
}: BrainPageOrganizeDialogProps) {
  const renamePage = useConvexMutation(renamePageRef)
  const movePage = useConvexMutation(movePageRef)
  const pagesQuery = useConvexQuery(listPagesRef, { workspaceId })
  const options = [
    { value: ROOT_PAGE, label: 'Top level' },
    ...((pagesQuery.data ?? []) as readonly OrganizePage[])
      .filter((candidate) => candidate._id !== page._id)
      .map((candidate) => ({ value: candidate._id, label: candidate.title })),
  ]
  const form = useAppForm({
    validators: { onSubmit: schema },
    defaultValues: {
      title: page.title,
      parentPageId: page.parentPageId ?? ROOT_PAGE,
    },
    onSubmit: async ({ value }) => {
      let updatedAt = page.updatedAt
      try {
        if (value.title.trim() !== page.title) {
          const renamed = await renamePage({
            workspaceId,
            pageId: page._id,
            expectedUpdatedAt: updatedAt,
            title: value.title,
          })
          updatedAt = renamed.updatedAt
        }
        const parentPageId =
          value.parentPageId === ROOT_PAGE ? null : value.parentPageId
        if (parentPageId !== (page.parentPageId ?? null)) {
          const moved = await movePage({
            workspaceId,
            pageId: page._id,
            expectedUpdatedAt: updatedAt,
            parentPageId,
            sortKey: page.sortKey ?? Date.now().toString().padStart(13, '0'),
          })
          updatedAt = moved.updatedAt
        }
        onUpdated(updatedAt)
        toast.success({ title: 'Brain page updated' })
        dialogProps.onOpenChange?.({ open: false })
      } catch {
        toast.error({
          title: 'Unable to organize this page',
          description: 'Reload the page if it changed in another session.',
        })
      }
    },
  })

  return (
    <Dialog.Root {...dialogProps}>
      <Dialog.Content>
        <Form form={form}>
          <Dialog.Header>
            <Dialog.Title>Organize Brain page</Dialog.Title>
            <Dialog.CloseButton />
          </Dialog.Header>
          <Dialog.Body>
            <form.Layout>
              <form.AppField name="title">
                {(field) => <field.TextField label="Page title" autoFocus />}
              </form.AppField>
              <form.AppField name="parentPageId">
                {(field) => (
                  <field.SelectField label="Parent page" options={options} />
                )}
              </form.AppField>
            </form.Layout>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.ActionTrigger asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.ActionTrigger>
            <form.SubmitButton>Save changes</form.SubmitButton>
          </Dialog.Footer>
        </Form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
