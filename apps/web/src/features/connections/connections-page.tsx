import React from 'react'

import { SimpleGrid } from '@chakra-ui/react'
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
} from './connections-adapter'
import {
  isLiveSlackOauthTransition,
  runSlackConnect,
} from './slack-connect'

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
const syncSlackRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.syncSlack,
)

const connectionType = (
  status: ConnectionStatus,
  integration: ConnectionCardModel,
  connection: DurableConnection | undefined,
) => {
  if (integration.id !== 'slack' || status !== 'connected')
    return connectionCardType(status)
  if (connection?.syncStatus === 'syncing') return 'Connected · Synchronizing'
  if (connection?.syncStatus === 'error') return 'Connected · Sync needs attention'
  if (connection?.syncStatus === 'ready')
    return `Connected · ${connection.lastSyncMessageCount ?? 0} messages synced`
  return 'Connected · Initial sync pending'
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

  const transition = async (
    id: ConnectionCardModel['id'],
    event: 'connect' | 'disconnect',
  ) => {
    const mode = connectionRuntimeMode(isolatedContracts, fixtureRuntime)
    if (isLiveSlackOauthTransition({ mode, provider: id, event })) {
      await runSlackConnect({
        begin: () => beginSlackOauth({ workspaceId: workspace.id }),
        open: openNangoConnect,
        complete: async ({ connectionId, generation }) => {
          await completeSlackOauth({
            workspaceId: workspace.id,
            generation,
            connectionId,
          })
          await syncSlack({ workspaceId: workspace.id })
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
          return (
        <IntegrationCard
          key={integration.id}
          {...integration}
          type={connectionType(status, integration, connection)}
          isConnected={status === 'connected'}
          onConnect={() => transition(integration.id, 'connect')}
          onDisconnect={() => transition(integration.id, 'disconnect')}
          onSync={
            integration.id === 'slack' && status === 'connected'
              ? () => syncSlack({ workspaceId: workspace.id })
              : undefined
          }
          onDocs={() => window.open(integration.docs, '_blank', 'noopener')}
        />
          )
        })()
      ))}
    </SimpleGrid>
  )
}
