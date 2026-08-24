'use client'

import { IconButton, Tooltip } from '@saas-ui/react'
import { LuPlus } from 'react-icons/lu'
import type { FC } from 'react'

import { useModals } from '@workspace/ui/modals'

import { BrainPageCreateDialog } from './brain-page-create-dialog'

type InboxToolbarProps = {
  workspaceId: string
  workspaceSlug: string
}

const BrainInboxToolbar = ({
  workspaceSlug,
}: InboxToolbarProps) => {
  const modals = useModals()
  return (
    <Tooltip content="New Brain page">
      <IconButton
        aria-label="New Brain page"
        variant="ghost"
        onClick={() => modals.open(BrainPageCreateDialog, { workspaceSlug })}
      >
        <LuPlus />
      </IconButton>
    </Tooltip>
  )
}

const ContactsInboxToolbar: FC<InboxToolbarProps> = () => null

export const inboxToolbarComponents = {
  brain: BrainInboxToolbar,
  contacts: ContactsInboxToolbar,
} as const
