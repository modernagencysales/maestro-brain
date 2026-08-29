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
import { LuInbox } from 'react-icons/lu'
import { useModals } from '@workspace/ui/modals'

import { api } from '#lib/trpc/react'
import { productShell } from '#config/product-shell'
import { useCurrentWorkspace } from '#features/common/hooks/use-current-workspace.ts'
import { useOpenState } from '#hooks/use-open-state.ts'

import {
  projectBrainPagesToTree,
  useBrainPages,
} from './brain-inbox-adapter'
import { BrainPageCreateDialog } from './brain-page-create-dialog'
import { BrainPagesPanel } from './brain-pages-panel'
import { BrainKnowledgeReviewDialog } from './brain-knowledge-review-dialog'
import { inboxToolbarComponents } from './brain-inbox-toolbar'
import { InboxList } from './inbox-list.tsx'

type InboxLayoutProps = {
  params: { workspace: string; id?: string }
  children: React.ReactElement
}

function BrainWorkspaceLayout({ params, children }: InboxLayoutProps) {
  const navigate = useNavigate()
  const modals = useModals()
  const [workspace] = useCurrentWorkspace()
  const [, startTransition] = React.useTransition()
  const { pages, isLoading } = useBrainPages({ workspaceId: workspace.id })
  const rows = React.useMemo(() => projectBrainPagesToTree(pages), [pages])
  const isMobile = useBreakpointValue(
    { base: true, lg: false },
    { fallback: 'lg' },
  )
  const [width, setWidth] = useLocalStorage('app.brain-pages.width', 300)
  const { open, setOpen } = useOpenState({ defaultOpen: Boolean(params.id) })

  const selectPage = React.useCallback(
    (pageId: string) => {
      startTransition(() => {
        navigate({
          to: '/$workspace/inbox/$id',
          params: { workspace: params.workspace, id: pageId },
          search: { contactId: pageId },
        })
      })
      setOpen(true)
    },
    [navigate, params.workspace, setOpen],
  )

  React.useEffect(() => {
    if (!params.id && !isLoading && isMobile === false && rows[0]) {
      selectPage(rows[0].page._id)
    }
  }, [isLoading, isMobile, params.id, rows, selectPage])

  React.useEffect(() => {
    if (params.id) setOpen(true)
    else if (isMobile) setOpen(false)
  }, [isMobile, params.id, setOpen])

  const createPage = () =>
    modals.open(BrainPageCreateDialog, { workspaceSlug: params.workspace })

  return (
    <SplitPage
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      breakpoint="lg"
      data-testid="brain-split-page"
    >
      <Resizer
        defaultWidth={width}
        onResize={({ width: nextWidth }) => setWidth(nextWidth)}
        enabled={isMobile === false}
      >
        <Page.Root
          as="section"
          aria-label="Brain page tree"
          borderRightWidth={{ base: 0, lg: '1px' }}
          minWidth="260px"
          maxW={{ base: '100%', lg: '520px' }}
          position="relative"
          loading={isLoading}
          flex={{ base: '1', lg: 'none' }}
        >
          <Page.Header title="Brain" />
          <Page.Body p="0">
            <BrainPagesPanel
              activePageId={params.id}
              rows={rows}
              onConnectDrive={() =>
                navigate({ to: '/$workspace', params: { workspace: params.workspace } })
              }
              onConnectSlack={() =>
                navigate({ to: '/$workspace', params: { workspace: params.workspace } })
              }
              onCreate={createPage}
              onReview={() =>
                modals.open(BrainKnowledgeReviewDialog, {
                  workspaceId: workspace.id,
                })
              }
              onSelect={selectPage}
            />
          </Page.Body>
          <ResizeHandle />
        </Page.Root>
      </Resizer>
      {children}
    </SplitPage>
  )
}

function ContactsInboxLayout({ params, children }: InboxLayoutProps) {
  const navigate = useNavigate()
  const [workspace] = useCurrentWorkspace()
  const [, startTransition] = React.useTransition()
  const { data, isLoading } = api.notifications.inbox.useQuery({
    workspaceId: workspace.id,
  })
  const InboxToolbar = inboxToolbarComponents.contacts
  const isMobile = useBreakpointValue(
    { base: true, lg: false },
    { fallback: 'base' },
  )
  const { open, setOpen } = useOpenState({ defaultOpen: Boolean(params.id) })
  const [width, setWidth] = useLocalStorage('app.inbox-list.width', 280)
  const notifications = data?.notifications ?? []

  React.useEffect(() => {
    if (!params.id && !isLoading && !isMobile && notifications[0]) {
      const firstItem = notifications[0]
      startTransition(() => {
        navigate({
          to: '/$workspace/inbox/$id',
          params: { workspace: params.workspace, id: firstItem.id },
          search: { contactId: firstItem.subjectId },
        })
      })
    }
  }, [isLoading, isMobile, navigate, notifications, params.id, params.workspace])

  React.useEffect(() => {
    if (params.id) setOpen(true)
  }, [isMobile, params.id, setOpen])

  return (
    <SplitPage
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    >
      <Resizer
        defaultWidth={width}
        onResize={({ width: nextWidth }) => setWidth(nextWidth)}
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
          <Page.Header
            title={productShell.labels.inbox}
            actions={
              <ButtonGroup>
                <InboxToolbar
                  workspaceId={workspace.id}
                  workspaceSlug={params.workspace}
                />
              </ButtonGroup>
            }
          />
          <Page.Body p="0">
            {notifications.length > 0 ? (
              <InboxList items={notifications} />
            ) : (
              <EmptyState
                icon={<LuInbox />}
                title="Inbox zero"
                description="Nothing to do here"
                height="100%"
              />
            )}
          </Page.Body>
          <ResizeHandle />
        </Page.Root>
      </Resizer>
      {children}
    </SplitPage>
  )
}

export function InboxLayout(props: InboxLayoutProps) {
  return productShell.inbox === 'brain' ? (
    <BrainWorkspaceLayout {...props} />
  ) : (
    <ContactsInboxLayout {...props} />
  )
}
