import { useConvexQuery } from '@convex-dev/react-query'
import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import type { ContactDTO, ContactType } from '@workspace/api/types'
import { useQuery } from '@tanstack/react-query'

import { useWorkspaceSlug } from '#features/common/hooks/use-workspace-slug'
import {
  isFixtureAuthRuntime,
  isIsolatedContractsRuntime,
} from '#lib/auth/route-auth'
import { runIsolatedHeadlessOperation } from '#lib/headless-api'
import { api } from '#lib/trpc/react'

export type ClientWorkspace = Readonly<{
  _id: string
  slug: string
  name: string
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}>

type ContactsListDataResult = Readonly<{
  data: { contacts: ContactDTO[] }
  isLoading?: boolean
}>

type ContactDetailDataResult = Readonly<{
  data: ContactDTO | undefined
  isLoading?: boolean
}>

type ContactsListInput = Readonly<{
  workspaceId: string
  type?: ContactType
}>

export const projectClientWorkspaceToContact = (
  workspace: ClientWorkspace,
): ContactDTO => ({
  id: workspace._id,
  workspaceId: workspace.slug,
  name: workspace.name,
  email: workspace.slug,
  avatar: null,
  status: workspace.status === 'active' ? 'active' : 'inactive',
  type: 'customer',
  tags: ['Client'],
  sortOrder: null,
  createdAt: new Date(workspace.createdAt),
  updatedAt: new Date(workspace.updatedAt),
})

export const projectClientWorkspacesToContacts = (
  workspaces: readonly ClientWorkspace[],
  currentWorkspaceIdentity?: string,
): { contacts: ContactDTO[] } => ({
  contacts: workspaces
    .filter(
      ({ _id, slug }) =>
        _id !== currentWorkspaceIdentity && slug !== currentWorkspaceIdentity,
    )
    .map(projectClientWorkspaceToContact),
})

export const contactNavigationFor = (
  mode: 'clients' | 'contacts',
  contact: Pick<ContactDTO, 'id' | 'workspaceId'>,
  currentWorkspaceSlug: string,
) =>
  mode === 'clients'
    ? {
        to: '/$workspace/inbox' as const,
        params: { workspace: contact.workspaceId },
      }
    : {
        to: '/$workspace/contacts/view/$id' as const,
        params: { workspace: currentWorkspaceSlug, id: contact.id },
      }

export const clientWorkspaceFixtures: readonly ClientWorkspace[] = [
  {
    _id: 'client-northstar',
    slug: 'northstar',
    name: 'Northstar Labs',
    status: 'active',
    createdAt: 1_782_924_800_000,
    updatedAt: 1_782_928_400_000,
  },
  {
    _id: 'client-juniper',
    slug: 'juniper',
    name: 'Juniper Works',
    status: 'active',
    createdAt: 1_782_406_400_000,
    updatedAt: 1_782_838_400_000,
  },
]

const clientWorkspacesListRef = getFunctionReference(
  templateConfectRefs.public.auth.workspaces.list,
)

const useAuthorizedClientWorkspaces = (): {
  workspaces: readonly ClientWorkspace[]
  isLoading: boolean
} => {
  const isolatedContracts = isIsolatedContractsRuntime()
  const fixtureRuntime = isFixtureAuthRuntime() && !isolatedContracts
  const convexResult = useConvexQuery(
    clientWorkspacesListRef,
    fixtureRuntime || isolatedContracts ? 'skip' : {},
  )
  const contractResult = useQuery({
    queryKey: ['authorized-workspaces', 'isolated-contracts'],
    queryFn: () =>
      runIsolatedHeadlessOperation<readonly ClientWorkspace[]>({
        operationId: 'auth.workspaces.list',
      }),
    enabled: isolatedContracts,
  })
  return {
    workspaces: fixtureRuntime
      ? clientWorkspaceFixtures
      : isolatedContracts
        ? (contractResult.data ?? [])
        : (convexResult.data ?? []),
    isLoading: isolatedContracts
      ? contractResult.isLoading
      : fixtureRuntime
        ? false
        : convexResult.isLoading,
  }
}

const useClientsList = ({
  workspaceId,
  type,
}: ContactsListInput): ContactsListDataResult => {
  void type
  const workspaceSlug = useWorkspaceSlug()
  const result = useAuthorizedClientWorkspaces()
  return {
    data: projectClientWorkspacesToContacts(
      result.workspaces,
      workspaceSlug || workspaceId,
    ),
    isLoading: result.isLoading,
  }
}

export const starterContactsListInput = ({
  workspaceId,
  type,
}: ContactsListInput): { workspaceId: string; type?: ContactType } =>
  type === undefined ? { workspaceId } : { workspaceId, type }

const useStarterContactsList = (input: ContactsListInput) =>
  api.contacts.listByType.useQuery(
    starterContactsListInput(input),
  ) as ContactsListDataResult

const useClientDetail = ({
  id,
}: {
  id: string
  workspaceId: string
}): ContactDetailDataResult => {
  const result = useAuthorizedClientWorkspaces()
  const workspace = result.workspaces.find((candidate) => candidate._id === id)
  return {
    data: workspace ? projectClientWorkspaceToContact(workspace) : undefined,
    isLoading: result.isLoading,
  }
}

const useStarterContactDetail = (input: {
  id: string
  workspaceId: string
}): ContactDetailDataResult => {
  const [data, result] = api.contacts.byId.useSuspenseQuery(input)
  return { ...result, data }
}

export const contactsListDataHooks = {
  clients: useClientsList,
  contacts: useStarterContactsList,
} as const

export const contactDetailDataHooks = {
  clients: useClientDetail,
  contacts: useStarterContactDetail,
} as const
