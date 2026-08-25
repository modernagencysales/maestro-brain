'use client'

import * as React from 'react'

import { ResizeHandle, Resizer, SplitPage } from '@saas-ui-pro/react'
import { useLocalStorage } from '@saas-ui/hooks'
import {
  Button,
  ButtonGroup,
  EmptyState,
  Page,
  useBreakpointValue,
} from '@saas-ui/react'
import { useNavigate } from '@tanstack/react-router'
import { LuBookOpen, LuInbox } from 'react-icons/lu'
import type { NotificationDTO } from '@workspace/api/types'
import { useModals } from '@workspace/ui/modals'

import { useCurrentWorkspace } from '#features/common/hooks/use-current-workspace.ts'
import { useOpenState } from '#hooks/use-open-state.ts'
import { productShell } from '#config/product-shell'

import { inboxDataHooks } from './brain-inbox-adapter'
import { inboxToolbarComponents } from './brain-inbox-toolbar'
import { BrainPageCreateDialog } from './brain-page-create-dialog'
import { InboxList } from './inbox-list.tsx'

const BrainInboxEmptyState = ({ workspace }: { workspace: string }) => {
  const navigate = useNavigate()
  const modals = useModals()
  return (
    <EmptyState
      icon={<LuBookOpen />}
      title="Build your company Brain"
      description="Create a page for company context, positioning, processes, or client knowledge. Pages are available to your team and connected agents."
      height="100%"
    >
      <Button
        variant="primary"
        colorPalette="accent"
        onClick={() =>
          modals.open(BrainPageCreateDialog, { workspaceSlug: workspace })
        }
      >
        Create first page
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          navigate({ to: '/$workspace', params: { workspace } })
        }
      >
        Connect a source
      </Button>
    </EmptyState>
  )
}

const ContactsInboxEmptyState = () => (
  <EmptyState
    icon={<LuInbox />}
    title="Inbox zero"
    description="Nothing to do here"
    height="100%"
  />
)

const inboxEmptyStateComponents = {
  brain: BrainInboxEmptyState,
  contacts: ContactsInboxEmptyState,
} as const

const InboxCollection = ({
  emptyState,
  items,
  open,
}: {
  emptyState: React.ReactNode
  items: NotificationDTO[]
  open: boolean
}) => {
  if (items.length === 0 && !open) return emptyState
  return <InboxList items={items} />
}

export function InboxLayout({
  params,
  children,
}: {
  params: { workspace: string; id?: string }
  children: React.ReactElement
}) {
  const navigate = useNavigate()

  const [workspace] = useCurrentWorkspace()

  const [, startTransition] = React.useTransition()

  const useInboxData = inboxDataHooks[productShell.inbox]
  const InboxToolbar = inboxToolbarComponents[productShell.inbox]
  const InboxEmptyState = inboxEmptyStateComponents[productShell.inbox]
  const { data, isLoading } = useInboxData({ workspaceId: workspace.id })

  const isMobile = useBreakpointValue(
    { base: true, lg: false },
    { fallback: 'base' },
  )

  const { open, setOpen } = useOpenState({
    defaultOpen: !!params.id,
  })

  const [width, setWidth] = useLocalStorage('app.inbox-list.width', 280)

  React.useEffect(() => {
    if (!params.id && !isLoading && !isMobile) {
      const firstItem = data?.notifications[0]
      if (firstItem) {
        // redirect to the first inbox notification if it's available.
        startTransition(() => {
          navigate({
            to: '/$workspace/inbox/$id',
            params: {
              workspace: params.workspace,
              id: firstItem.id,
            },
            search: {
              contactId: firstItem.subjectId,
            },
            mask: {
              to: '/$workspace/contacts/view/$id',
              params: {
                workspace: params.workspace,
                id: firstItem.subjectId,
              },
            },
          })
        })
      }
    }
  }, [data, isLoading, isMobile, params])

  React.useEffect(() => {
    if (params.id) {
      setOpen(true)
    }
    // the isMobile dep is needed so that the SplitPage
    // will open again when the screen size changes to lg
  }, [params, isMobile, setOpen])

  // const [visibleProps, setVisibleProps] = React.useState<string[]>([])

  const notifications = data?.notifications ?? []

  // const displayProperties = (
  //   <ToggleButtonGroup
  //     type="checkbox"
  //     isAttached={false}
  //     size="xs"
  //     spacing="0"
  //     flexWrap="wrap"
  //     value={visibleProps}
  //     onChange={setVisibleProps}
  //   >
  //     {['id'].map((id) => {
  //       return (
  //         <ToggleButton
  //           key={id}
  //           value={id}
  //           mb="1"
  //           me="1"
  //           color="muted"
  //           _checked={{ color: 'app-text', bg: 'whiteAlpha.200' }}
  //         >
  //           {id.charAt(0).toUpperCase() + id.slice(1)}
  //         </ToggleButton>
  //       )
  //     })}
  //   </ToggleButtonGroup>
  // )

  const toolbar = (
    <ButtonGroup>
      <InboxToolbar
        workspaceId={workspace.id}
        workspaceSlug={params.workspace}
      />
      {/* <Menu>
        <Tooltip label="Display settings">
          <MenuButton
            as={IconButton}
            icon={<LuSlidersHorizontal />}
            aria-label="Display settings"
            variant="tertiary"
            size="xs"
          />
        </Tooltip>
        <Portal>
          <MenuList maxW="260px">
            <MenuProperty
              label="Show snoozed"
              value={<Switch size="sm" defaultChecked={false} />}
            />
            <MenuProperty label="Show read" value={<Switch size="sm" />} />
            <Divider />
            <MenuProperty
              label="Display properties"
              value={displayProperties}
              orientation="vertical"
            />
          </MenuList>
        </Portal>
      </Menu> */}
    </ButtonGroup>
  )

  const emptyState = <InboxEmptyState workspace={params.workspace} />

  return (
    <SplitPage
      open={!!open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    >
      <Resizer
        defaultWidth={width}
        onResize={({ width }) => setWidth(width)}
        enabled={!isMobile}
      >
        <Page.Root
          as="div"
          borderRightWidth={{ base: 0, lg: '1px' }}
          minWidth="280px"
          maxW={{ base: '100%', lg: '640px' }}
          position="relative"
          loading={isLoading}
          flex={{ base: '1', lg: 'unset' }}
        >
          <Page.Header title={productShell.labels.inbox} actions={toolbar} />
          <Page.Body p="0">
            <InboxCollection
              emptyState={emptyState}
              items={notifications}
              open={!!open}
            />
          </Page.Body>
          <ResizeHandle />
        </Page.Root>
      </Resizer>
      {children}
    </SplitPage>
  )
}
