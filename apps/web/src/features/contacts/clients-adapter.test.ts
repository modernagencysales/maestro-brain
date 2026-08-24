import { describe, expect, it, vi } from 'vitest'

const clientAdapterMocks = vi.hoisted(() => ({
  headless: vi.fn(async () => []),
}))

vi.mock('@convex-dev/react-query', () => ({
  useConvexQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => unknown }) => {
    void options.queryFn()
    return { data: [], isLoading: false }
  },
}))
vi.mock('#features/common/hooks/use-workspace-slug', () => ({
  useWorkspaceSlug: () => 'agency',
}))
vi.mock('#lib/auth/route-auth', () => ({
  isFixtureAuthRuntime: () => true,
  isIsolatedContractsRuntime: () => false,
}))
vi.mock('#lib/headless-api', () => ({
  runIsolatedHeadlessOperation: clientAdapterMocks.headless,
}))

import {
  clientWorkspaceFixtures,
  contactNavigationFor,
  contactDetailDataHooks,
  contactsListDataHooks,
  projectClientWorkspaceToContact,
  projectClientWorkspacesToContacts,
  starterContactsListInput,
} from './clients-adapter'

describe('client workspaces to Starter Contacts adapter', () => {
  it('projects client identity into the untouched Starter contact contract', () => {
    expect(
      projectClientWorkspaceToContact({
        _id: 'workspace-northstar',
        slug: 'northstar',
        name: 'Northstar Labs',
        status: 'active',
        createdAt: 1_782_924_800_000,
        updatedAt: 1_782_928_400_000,
      }),
    ).toEqual({
      id: 'workspace-northstar',
      workspaceId: 'northstar',
      name: 'Northstar Labs',
      email: 'northstar',
      avatar: null,
      status: 'active',
      type: 'customer',
      tags: ['Client'],
      sortOrder: null,
      createdAt: new Date(1_782_924_800_000),
      updatedAt: new Date(1_782_928_400_000),
    })
  })

  it('switches workspace before opening a client Brain', () => {
    expect(
      contactNavigationFor(
        'clients',
        { id: 'workspace-northstar', workspaceId: 'northstar' },
        'agency',
      ),
    ).toEqual({
      to: '/$workspace/inbox',
      params: { workspace: 'northstar' },
    })
    expect(
      contactNavigationFor(
        'contacts',
        { id: 'workspace-northstar', workspaceId: 'northstar' },
        'agency',
      ),
    ).toEqual({
      to: '/$workspace/contacts/view/$id',
      params: { workspace: 'agency', id: 'workspace-northstar' },
    })
  })

  it('excludes the active agency workspace from its client list', () => {
    expect(
      projectClientWorkspacesToContacts(clientWorkspaceFixtures, 'client-northstar')
        .contacts.map(({ name }) => name),
    ).toEqual(['Juniper Works'])
    expect(
      projectClientWorkspacesToContacts(clientWorkspaceFixtures, 'northstar')
        .contacts.map(({ name }) => name),
    ).toEqual(['Juniper Works'])
  })

  it('projects archived client workspaces as inactive Starter contacts', () => {
    const workspace = clientWorkspaceFixtures[0]
    if (workspace === undefined) throw new Error('missing client fixture')
    expect(
      projectClientWorkspaceToContact({
        ...workspace,
        status: 'archived',
      }),
    ).toMatchObject({ status: 'inactive' })
  })

  it('ships populated fake-safe Clients data', () => {
    expect(projectClientWorkspacesToContacts(clientWorkspaceFixtures).contacts)
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Northstar Labs' }),
          expect.objectContaining({ name: 'Juniper Works' }),
        ]),
      )
  })

  it('adapts authorized fixture workspaces through the complete Starter hooks', () => {
    expect(
      contactsListDataHooks.clients({ workspaceId: 'agency' }).data.contacts,
    ).toHaveLength(2)
    expect(
      contactDetailDataHooks.clients({
        workspaceId: 'agency',
        id: 'client-northstar',
      }).data,
    ).toMatchObject({ name: 'Northstar Labs', workspaceId: 'northstar' })
    expect(clientAdapterMocks.headless).toHaveBeenCalled()
  })

  it('preserves the selected Starter contact type at the query adapter', () => {
    expect(
      starterContactsListInput({
        workspaceId: 'workspace-northstar',
        type: 'lead',
      }),
    ).toEqual({ workspaceId: 'workspace-northstar', type: 'lead' })
    expect(
      starterContactsListInput({ workspaceId: 'workspace-northstar' }),
    ).toEqual({ workspaceId: 'workspace-northstar' })
    expect(
      contactsListDataHooks.contacts({
        workspaceId: 'workspace-northstar',
        type: 'lead',
      }).data,
    ).toEqual({ contacts: [] })
    expect(
      contactDetailDataHooks.contacts({
        workspaceId: 'workspace-northstar',
        id: 'contact-1',
      }).data,
    ).toEqual([])
  })
})
