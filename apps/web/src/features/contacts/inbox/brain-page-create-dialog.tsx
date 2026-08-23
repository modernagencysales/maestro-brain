'use client'

import { Button, Dialog, toast } from '@saas-ui/react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation as useConvexMutation } from 'convex/react'
import { z } from 'zod'

import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import { Form, useAppForm } from '@workspace/ui/form'

import { useCurrentWorkspace } from '#features/common/hooks/use-current-workspace'

const createPageRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.createMarkdown,
)

const schema = z.object({
  title: z
    .string()
    .min(1, 'Please enter a title')
    .max(160, 'Title can be at most 160 characters long')
    .describe('Page title'),
})

export const slugForTitle = (title: string, now = Date.now()) => {
  const base = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 48)
  return `${base || 'page'}-${now.toString(36)}`
}

export interface BrainPageCreateDialogProps extends Omit<
  Dialog.RootProps,
  'children'
> {
  workspaceSlug: string
}

export function BrainPageCreateDialog(props: BrainPageCreateDialogProps) {
  const navigate = useNavigate()
  const [workspace] = useCurrentWorkspace()
  const createPage = useConvexMutation(createPageRef)
  const form = useAppForm({
    validators: { onSubmit: schema },
    defaultValues: { title: '' },
    onSubmit: async ({ value }) => {
      const slug = slugForTitle(value.title)
      try {
        const pageId = await createPage({
          workspaceId: workspace.id,
          slug,
          title: value.title,
          markdown: `# ${value.title.trim()}\n`,
          parentPageId: null,
          sortKey: Date.now().toString().padStart(13, '0'),
        })
        toast.success({ title: 'Brain page created' })
        await navigate({
          to: '/$workspace/inbox/$id',
          params: { workspace: props.workspaceSlug, id: pageId },
          search: { contactId: pageId },
        })
        props.onOpenChange?.({ open: false })
      } catch {
        toast.error({ title: 'Unable to create this Brain page' })
      }
    },
  })

  return (
    <Dialog.Root {...props}>
      <Dialog.Content>
        <Form form={form}>
          <Dialog.Header>
            <Dialog.Title>New Brain page</Dialog.Title>
            <Dialog.CloseButton />
          </Dialog.Header>
          <Dialog.Body>
            <form.Layout>
              <form.AppField name="title">
                {(field) => (
                  <field.TextField
                    label="Page title"
                    placeholder="Positioning and proof"
                    autoFocus
                  />
                )}
              </form.AppField>
            </form.Layout>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.ActionTrigger asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.ActionTrigger>
            <form.SubmitButton>Create page</form.SubmitButton>
          </Dialog.Footer>
        </Form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
