'use client'

import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import { useConvexQuery } from '@convex-dev/react-query'
import { useMutation as useConvexMutation } from 'convex/react'
import { Editor } from '@workspace/ui/editor'
import { Skeleton } from '@chakra-ui/react'
import {
  ButtonGroup,
  IconButton,
  Menu,
  Tooltip,
  toast,
} from '@saas-ui/react'
import {
  LuArchive,
  LuChevronLeft,
  LuEllipsisVertical,
  LuFileText,
  LuHistory,
  LuPencil,
  LuStar,
} from 'react-icons/lu'
import { useModals } from '@workspace/ui/modals'

import { productShell } from '#config/product-shell'
import { useCurrentWorkspace } from '#features/common/hooks/use-current-workspace'
import {
  isFixtureAuthRuntime,
  isIsolatedContractsRuntime,
} from '#lib/auth/route-auth'
import { runIsolatedHeadlessOperation } from '#lib/headless-api'

import { brainInboxFixtures } from './brain-inbox-adapter'
import { BrainPageOrganizeDialog } from './brain-page-organize-dialog'
import { BrainPageHistoryDialog } from './brain-page-history-dialog'
import {
  classifyBrainSaveFailure,
  shouldPersistBrainMarkdown,
  type BrainSaveState,
} from './brain-page-editor-state'
import { ContactPageComposition } from '../view/contact-page'

const getPageRef = getFunctionReference(templateConfectRefs.public.brain.pages.get)
const updatePageRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.updateMarkdown,
)
const favoritePageRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.favorite,
)
const archivePageRef = getFunctionReference(
  templateConfectRefs.public.brain.pages.archive,
)

const fixtureMarkdown = `# Client overview

Use this shared page to keep the client's context, positioning, decisions, and next steps current.`

type BrainEditorPage = Readonly<{
  _id: string
  title: string
  markdown: string
  updatedAt: number
  favorite?: boolean
  status?: 'active' | 'archived'
  parentPageId?: string | null
  sortKey?: string
}>

const fixturePage = (pageId: string): BrainEditorPage => {
  const fixture = brainInboxFixtures.find((page) => page._id === pageId)
  return {
    _id: fixture?._id ?? pageId,
    title: fixture?.title ?? 'Agency Brain page',
    markdown: fixtureMarkdown,
    updatedAt: fixture?.updatedAt ?? 1_782_924_800_000,
  }
}

const showBrainSaveFailure = (error: unknown) => {
  const failure = classifyBrainSaveFailure(error)
  toast.error({
    title:
      failure === 'conflict'
        ? 'This page changed in another session'
        : 'Unable to save this page',
    description:
      failure === 'conflict'
        ? 'Your draft is still here. Reload the page before saving again.'
        : 'Your draft is still here. Try again in a moment.',
  })
  return failure
}

const pageMarkdown = (page: BrainEditorPage | undefined) => page?.markdown ?? ''
const pageUpdatedAt = (page: BrainEditorPage | undefined) => page?.updatedAt ?? 0
const useBrainPage = (input: {
  fixtureRuntime: boolean
  isolatedContracts: boolean
  pageId: string
  workspaceId: string
}): BrainEditorPage | undefined => {
  const convexQuery = useConvexQuery(
    getPageRef,
    input.fixtureRuntime
      ? 'skip'
      : { workspaceId: input.workspaceId, pageId: input.pageId as never },
  )
  const contractQuery = useQuery({
    queryKey: ['brain-page', 'isolated-contracts', input.pageId],
    queryFn: () =>
      runIsolatedHeadlessOperation<BrainEditorPage>({
        operationId: 'brain.pages.get',
        operationInput: { pageId: input.pageId },
      }),
    enabled: input.isolatedContracts,
  })
  return input.isolatedContracts
    ? contractQuery.data
    : input.fixtureRuntime
      ? fixturePage(input.pageId)
      : (convexQuery as BrainEditorPage | undefined)
}

const useBrainMarkdown = (input: {
  fixtureRuntime: boolean
  isolatedContracts: boolean
  page: BrainEditorPage | undefined
  workspaceId: string
}) => {
  const updateMarkdown = useConvexMutation(updatePageRef)
  const updateMarkdownRef = React.useRef(updateMarkdown)
  const [markdown, setMarkdown] = React.useState(pageMarkdown(input.page))
  const loadedMarkdownRef = React.useRef(pageMarkdown(input.page))
  const revisionRef = React.useRef(pageUpdatedAt(input.page))
  const failedSaveRef = React.useRef('')
  const [saveState, setSaveState] = React.useState<BrainSaveState>('idle')
  const [savedUpdatedAt, setSavedUpdatedAt] = React.useState(
    pageUpdatedAt(input.page),
  )

  updateMarkdownRef.current = updateMarkdown

  React.useEffect(() => {
    setMarkdown(pageMarkdown(input.page))
    loadedMarkdownRef.current = pageMarkdown(input.page)
    revisionRef.current = pageUpdatedAt(input.page)
    setSavedUpdatedAt(pageUpdatedAt(input.page))
    failedSaveRef.current = ''
    setSaveState('idle')
  }, [input.page?._id, input.page?.markdown, input.page?.updatedAt])

  React.useEffect(() => {
    if (
      !input.page ||
      !shouldPersistBrainMarkdown({
        fixtureRuntime: input.fixtureRuntime && !input.isolatedContracts,
        pageLoaded: input.page !== undefined,
        loadedMarkdown: loadedMarkdownRef.current,
        draftMarkdown: markdown,
      })
    )
      return
    const page = input.page
    const saveKey = `${revisionRef.current}:${markdown}`
    if (failedSaveRef.current === saveKey) return
    const timeout = window.setTimeout(() => {
      setSaveState('saving')
      const expectedUpdatedAt = revisionRef.current
      const update = input.isolatedContracts
        ? runIsolatedHeadlessOperation<BrainEditorPage>({
            operationId: 'brain.pages.updateMarkdown',
            operationInput: {
              pageId: page._id,
              markdown,
              expectedUpdatedAt,
            },
            idempotencyKey: `brain-page-update-${page._id}-${expectedUpdatedAt}`,
          })
        : updateMarkdownRef.current({
            workspaceId: input.workspaceId,
            pageId: page._id,
            markdown,
            expectedUpdatedAt,
          })
      void update.then((updated) => {
        revisionRef.current = updated.updatedAt
        loadedMarkdownRef.current = markdown
        setSavedUpdatedAt(updated.updatedAt)
        failedSaveRef.current = ''
        setSaveState('saved')
      }).catch((error: unknown) => {
        failedSaveRef.current = saveKey
        setSaveState(showBrainSaveFailure(error))
      })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [
    input.fixtureRuntime,
    input.isolatedContracts,
    input.page?._id,
    input.workspaceId,
    markdown,
  ])

  const updateDraft = React.useCallback((value: string) => {
    failedSaveRef.current = ''
    setSaveState('idle')
    setMarkdown(value)
  }, [])
  const acceptMutation = React.useCallback((updatedAt: number) => {
    revisionRef.current = updatedAt
    setSavedUpdatedAt(updatedAt)
  }, [])

  return {
    markdown,
    setMarkdown: updateDraft,
    saveState,
    savedUpdatedAt,
    acceptMutation,
    hasPendingChanges:
      input.page !== undefined && markdown !== loadedMarkdownRef.current,
  } as const
}

const isBrainMutationDisabled = (input: {
  fixtureRuntime: boolean
  pageLoaded: boolean
  actionPending: boolean
  hasPendingChanges: boolean
  saveState: BrainSaveState
}) =>
  input.fixtureRuntime ||
  !input.pageLoaded ||
  input.actionPending ||
  input.hasPendingChanges ||
  input.saveState === 'saving' ||
  input.saveState === 'conflict'

function BrainPageToolbar(props: {
  disabled: boolean
  favorite: boolean
  inboxLabel: string
  onArchive: () => Promise<void>
  onBack: () => Promise<void>
  onFavorite: () => Promise<void>
  onHistory: () => void
  onOrganize: () => void
}) {
  const favoriteLabel = props.favorite ? 'Remove favorite' : 'Add favorite'
  const starFill = props.favorite ? 'currentColor' : 'none'
  return (
    <ButtonGroup>
      <IconButton
        display={{ base: 'inline-flex', lg: 'none' }}
        aria-label={`All ${props.inboxLabel}`}
        variant="ghost"
        onClick={props.onBack}
      >
        <LuChevronLeft />
      </IconButton>
      <Tooltip content={favoriteLabel}>
        <IconButton
          aria-label={favoriteLabel}
          variant="ghost"
          disabled={props.disabled}
          onClick={props.onFavorite}
        >
          <LuStar fill={starFill} />
        </IconButton>
      </Tooltip>
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            aria-label="Page actions"
            variant="ghost"
            disabled={props.disabled}
          >
            <LuEllipsisVertical />
          </IconButton>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="organize" onClick={props.onOrganize}>
            <LuPencil /> Rename or move
          </Menu.Item>
          <Menu.Item value="history" onClick={props.onHistory}>
            <LuHistory /> Page history
          </Menu.Item>
          <Menu.Item value="archive" onClick={props.onArchive}>
            <LuArchive /> Archive page
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </ButtonGroup>
  )
}

export function BrainInboxViewPage({
  params,
}: {
  params: { workspace: string; id: string }
  toolbarItems?: React.ReactNode
}) {
  const [workspace] = useCurrentWorkspace()
  const navigate = useNavigate()
  const modals = useModals()
  const fixtureRuntime = isFixtureAuthRuntime()
  const isolatedContracts = isIsolatedContractsRuntime()
  const page = useBrainPage({
    fixtureRuntime,
    isolatedContracts,
    pageId: params.id,
    workspaceId: workspace.id,
  })
  const {
    markdown,
    setMarkdown,
    saveState,
    savedUpdatedAt,
    acceptMutation,
    hasPendingChanges,
  } = useBrainMarkdown({
    fixtureRuntime,
    isolatedContracts,
    page,
    workspaceId: workspace.id,
  })
  const favoritePage = useConvexMutation(favoritePageRef)
  const archivePage = useConvexMutation(archivePageRef)
  const [actionPending, setActionPending] = React.useState(false)
  const mutationDisabled = isBrainMutationDisabled({
    fixtureRuntime,
    pageLoaded: page !== undefined,
    actionPending,
    hasPendingChanges,
    saveState,
  })
  const onBack = () =>
    navigate({
      to: '/$workspace/inbox',
      params: { workspace: params.workspace },
    })
  const onFavorite = async () => {
    if (!page) return
    setActionPending(true)
    try {
      const updated = await favoritePage({
        workspaceId: workspace.id,
        pageId: page._id,
        expectedUpdatedAt: savedUpdatedAt,
        favorite: !page.favorite,
      })
      acceptMutation(updated.updatedAt)
    } catch {
      toast.error({ title: 'Unable to update this favorite' })
    } finally {
      setActionPending(false)
    }
  }
  const onArchive = async () => {
    if (!page) return
    setActionPending(true)
    try {
      await archivePage({
        workspaceId: workspace.id,
        pageId: page._id,
        expectedUpdatedAt: savedUpdatedAt,
      })
      await onBack()
    } catch {
      setActionPending(false)
      toast.error({ title: 'Unable to archive this page' })
    }
  }
  const onOrganize = () => {
    if (!page) return
    modals.open(BrainPageOrganizeDialog, {
      page,
      workspaceId: workspace.id,
      onUpdated: acceptMutation,
    })
  }
  const onHistory = () => {
    if (!page) return
    modals.open(BrainPageHistoryDialog, {
      pageId: page._id,
      updatedAt: savedUpdatedAt,
      workspaceId: workspace.id,
      onUpdated: acceptMutation,
    })
  }

  const brainToolbar = (
    <BrainPageToolbar
      disabled={mutationDisabled}
      favorite={page?.favorite === true}
      inboxLabel={productShell.labels.inbox}
      onArchive={onArchive}
      onBack={onBack}
      onFavorite={onFavorite}
      onHistory={onHistory}
      onOrganize={onOrganize}
    />
  )

  return (
    <ContactPageComposition
      params={params}
      toolbarItems={brainToolbar}
      rootLabel={productShell.labels.inbox}
      rootTo="/$workspace/inbox"
      title={page?.title ?? 'Loading page'}
      primaryLabel="Page"
      primaryIcon={<LuFileText />}
      primaryContent={
        page ? (
          <Editor
            aria-label="Agency Brain page editor"
            value={markdown}
            onChange={setMarkdown}
            format="markdown"
            toolbar
            minHeight="60vh"
            placeholder="Write the company context your team and agents should know…"
          />
        ) : (
          <Skeleton aria-label="Loading Agency Brain page" height="60vh" />
        )
      }
    />
  )
}
