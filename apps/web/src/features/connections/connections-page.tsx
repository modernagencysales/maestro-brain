import React from 'react'

import { SimpleGrid } from '@chakra-ui/react'
import { toast } from '@saas-ui/react'
import { useConvexQuery } from '@convex-dev/react-query'
import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import { openNangoConnect } from '@maestro-template/integrations/nango/connectBrowser'
import {
  useAction as useConvexAction,
  useMutation as useConvexMutation,
} from 'convex/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IntegrationCard } from '#components/integration-card/integration-card'
import { useCurrentWorkspace } from '#features/common/hooks/use-current-workspace'
import {
  isFixtureAuthRuntime,
  isIsolatedContractsRuntime,
} from '#lib/auth/route-auth'
import { runIsolatedHeadlessOperation } from '#lib/headless-api'

import {
  connectionCardType,
  connectionFixtures,
  connectionRuntimeMode,
  connectionStatusForCard,
  executeConnectionTransition,
  transitionConnectionStatus,
  type ConnectionCardModel,
  type ConnectionStatus,
  type DurableConnection,
  type EvidenceProviderHealth,
} from './connections-adapter'
import { runSlackConnect } from './slack-connect'
import {
  ProviderSyncDialog,
  type ProviderScopeDiscovery,
  type SyncProvider,
} from './provider-sync-dialog'

const listConnectionsRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.list,
)
const beginConnectionRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.begin,
)
const revokeConnectionRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.revoke,
)
const beginSlackOauthRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.beginSlackOauth,
)
const completeSlackOauthRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.completeSlackOauth,
)
const beginProviderOauthRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.beginProviderOauth,
)
const completeProviderOauthRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.completeProviderOauth,
)
const discoverProviderScopesRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.discoverProviderScopes,
)
const syncSlackRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.syncSlack,
)
const syncGoogleDriveRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.syncGoogleDrive,
)
const syncHubSpotRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.syncHubSpot,
)
const evidenceHealthRef = getFunctionReference(
  templateConfectRefs.public.brain.evidence.health,
)

const evidenceProvider = (provider: ConnectionCardModel['id']) =>
  provider === 'google-drive' ? 'google_drive' : provider

const indexedLabel = (timestamp: number | null | undefined) =>
  timestamp == null
    ? ''
    : ` · Indexed ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp)}`

const connectionType = (
  status: ConnectionStatus,
  integration: ConnectionCardModel,
  connection: DurableConnection | undefined,
  health: EvidenceProviderHealth | undefined,
) => {
  const schedule = connection?.scheduledSyncEnabled
    ? ' · Hourly reconciliation'
    : ''
  if (status === 'connected' && health?.lastConnectorRun?.status === 'failed')
    return `Connected · Sync failed · ${health.activeSourceCount} sources${schedule}`
  if (status === 'connected' && health?.lastConnectorRun?.status === 'running')
    return `Connected · Synchronizing · ${health.activeSourceCount} sources${schedule}`
  if (status === 'connected' && health !== undefined)
    return `Connected · ${health.currentEntryCount}/${health.activeSourceCount} sources indexed${indexedLabel(health.latestIndexedAt)}${schedule}`
  if (integration.id !== 'slack' || status !== 'connected')
    return connectionCardType(status)
  if (connection?.syncStatus === 'syncing') return 'Connected · Synchronizing'
  if (connection?.syncStatus === 'error') return 'Connected · Sync needs attention'
  if (connection?.syncStatus === 'ready')
    return `Connected · ${connection.lastSyncMessageCount ?? 0} messages synced`
  return connectionCardType(status)
}

/** Exact Pro IntegrationCard story composition with an installed import seam. */
export const ConnectionsPage = () => {
  const [workspace] = useCurrentWorkspace()
  const isolatedContracts = isIsolatedContractsRuntime()
  const fixtureRuntime = isFixtureAuthRuntime() && !isolatedContracts
  const queryClient = useQueryClient()
  const durableConnections = useConvexQuery(
    listConnectionsRef,
    fixtureRuntime || isolatedContracts
      ? 'skip'
      : { workspaceId: workspace.id },
  )
  const evidenceHealth = useConvexQuery(
    evidenceHealthRef,
    fixtureRuntime || isolatedContracts
      ? 'skip'
      : { workspaceId: workspace.id },
  ) as { providers: readonly EvidenceProviderHealth[] } | undefined
  const isolatedConnections = useQuery({
    queryKey: ['provider-connections', 'isolated-contracts', workspace.id],
    queryFn: () =>
      runIsolatedHeadlessOperation<readonly DurableConnection[]>({
        operationId: 'integrations.connections.list',
      }),
    enabled: isolatedContracts,
  })
  const beginConnection = useConvexMutation(beginConnectionRef)
  const revokeConnection = useConvexMutation(revokeConnectionRef)
  const beginSlackOauth = useConvexAction(beginSlackOauthRef)
  const completeSlackOauth = useConvexAction(completeSlackOauthRef)
  const beginProviderOauth = useConvexAction(beginProviderOauthRef)
  const completeProviderOauth = useConvexAction(completeProviderOauthRef)
  const discoverProviderScopes = useConvexAction(discoverProviderScopesRef)
  const syncSlack = useConvexAction(syncSlackRef)
  const liveConnections = (
    isolatedContracts
      ? (isolatedConnections.data ?? [])
      : (durableConnections ?? [])
  ) as readonly DurableConnection[]
  const [statuses, setStatuses] = React.useState<
    Record<string, ConnectionStatus>
  >(() =>
    Object.fromEntries(
      connectionFixtures.map(({ id, status }) => [id, status]),
    ),
  )
  const [syncProvider, setSyncProvider] = React.useState<
    'slack' | 'google-drive' | 'hubspot' | null
  >(null)
  const syncConnection = liveConnections.find(
    (connection) => connection.provider === syncProvider,
  )
  const syncGoogleDrive = useConvexAction(syncGoogleDriveRef)
  const syncHubSpot = useConvexAction(syncHubSpotRef)
  const discoverScopes = React.useCallback(
    async (
      provider: SyncProvider,
      containerId?: string,
    ): Promise<ProviderScopeDiscovery> =>
      (await discoverProviderScopes({
        workspaceId: workspace.id,
        provider,
        ...(containerId === undefined ? {} : { containerId }),
      })) as ProviderScopeDiscovery,
    [discoverProviderScopes, workspace.id],
  )

  const transition = async (
    id: ConnectionCardModel['id'],
    event: 'connect' | 'disconnect',
  ) => {
    const mode = connectionRuntimeMode(isolatedContracts, fixtureRuntime)
    if (mode === 'live' && event === 'connect') {
      await runSlackConnect({
        begin: () =>
          id === 'slack'
            ? beginSlackOauth({ workspaceId: workspace.id })
            : beginProviderOauth({ workspaceId: workspace.id, provider: id }),
        open: openNangoConnect,
        complete: async ({ connectionId, generation }) => {
          if (id === 'slack') {
            await completeSlackOauth({
              workspaceId: workspace.id,
              generation,
              connectionId,
            })
            setSyncProvider('slack')
          } else {
            await completeProviderOauth({
              workspaceId: workspace.id,
              provider: id,
              generation,
              connectionId,
            })
            setSyncProvider(id)
          }
        },
      })
      return
    }
    await executeConnectionTransition({
      mode,
      provider: id,
      event,
      liveConnections,
      ports: {
        beginIsolated: (provider) =>
          runIsolatedHeadlessOperation<DurableConnection>({
          operationId: 'integrations.connections.begin',
            operationInput: { provider },
            idempotencyKey: `connect-${provider}-${Date.now()}`,
          }),
        completeIsolated: (provider, generation) =>
          runIsolatedHeadlessOperation<DurableConnection>({
          operationId: 'integrations.connections.complete',
          operationInput: {
              provider,
              generation,
            completion: {
              status: 'active',
                connectionRef: `contract-${provider}-${generation}`,
            },
          },
            idempotencyKey: `complete-${provider}-${generation}`,
          }),
        revokeIsolated: (provider, generation) =>
          runIsolatedHeadlessOperation<DurableConnection>({
            operationId: 'integrations.connections.revoke',
            operationInput: { provider, generation },
            idempotencyKey: `revoke-${provider}-${generation}`,
          }),
        invalidateIsolated: () =>
          queryClient.invalidateQueries({
            queryKey: [
              'provider-connections',
              'isolated-contracts',
              workspace.id,
            ],
          }),
        beginLive: (provider) =>
          beginConnection({ workspaceId: workspace.id, provider }),
        revokeLive: (provider, generation) =>
          revokeConnection({ workspaceId: workspace.id, provider, generation }),
        updateFixture: (provider, transitionEvent) =>
          setStatuses((current) => ({
            ...current,
            [provider]: transitionConnectionStatus(
              current[provider] ?? 'available',
              transitionEvent,
            ),
          })),
      },
    })
  }

  return (
    <>
      <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
        {connectionFixtures.map((integration) => (
        (() => {
          const status = connectionStatusForCard({
            fixtureRuntime,
            fixtureStatuses: statuses,
            provider: integration.id,
            liveConnections,
          })
          const connection = liveConnections.find(
            (candidate) => candidate.provider === integration.id,
          )
          const health = evidenceHealth?.providers.find(
            (candidate) => candidate.provider === evidenceProvider(integration.id),
          )
          return (
        <IntegrationCard
          key={integration.id}
          {...integration}
          type={connectionType(status, integration, connection, health)}
          isConnected={status === 'connected'}
          onConnect={() => transition(integration.id, 'connect')}
          onDisconnect={() => transition(integration.id, 'disconnect')}
          onSync={
            status !== 'connected'
              ? undefined
              : () => setSyncProvider(integration.id)
          }
          onDocs={() => window.open(integration.docs, '_blank', 'noopener')}
        />
          )
        })()
        ))}
      </SimpleGrid>
      <ProviderSyncDialog
        open={syncProvider !== null}
        provider={syncProvider}
        initialContainerId={
          syncProvider === 'google-drive'
            ? syncConnection?.googleDriveId
            : syncProvider === 'hubspot'
              ? syncConnection?.hubSpotPortalId
              : undefined
        }
        initialRootFolderIds={syncConnection?.googleDriveRootFolderIds}
        initialChannelIds={syncConnection?.slackChannelIds}
        onDiscover={discoverScopes}
        onClose={() => setSyncProvider(null)}
        onSync={async ({
          provider,
          containerId,
          rootFolderIds,
          channelIds,
        }) => {
          try {
            if (provider === 'slack')
              await syncSlack({
                workspaceId: workspace.id,
                channelIds: [...channelIds],
              })
            else if (provider === 'google-drive')
              await syncGoogleDrive({
                workspaceId: workspace.id,
                driveId: containerId,
                rootFolderIds: [...rootFolderIds],
              })
            else
              await syncHubSpot({
                workspaceId: workspace.id,
                portalId: containerId,
              })
            toast.success({ title: 'Company Brain sync complete' })
          } catch {
            toast.error({
              title: 'Company Brain sync failed',
              description: 'Check the approved scope IDs and try again.',
            })
            throw new Error('provider sync failed')
          }
        }}
      />
    </>
  )
}
