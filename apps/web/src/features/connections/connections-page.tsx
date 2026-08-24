import React from 'react'

import { SimpleGrid } from '@chakra-ui/react'
import { useConvexQuery } from '@convex-dev/react-query'
import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import { useMutation as useConvexMutation } from 'convex/react'
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

const listConnectionsRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.list,
)
const beginConnectionRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.begin,
)
const revokeConnectionRef = getFunctionReference(
  templateConfectRefs.public.integrations.connections.revoke,
)

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
  const liveConnections = (
    isolatedContracts
      ? (isolatedConnections.data ?? [])
      : (durableConnections?.data ?? [])
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
  ) =>
    executeConnectionTransition({
      mode: connectionRuntimeMode(isolatedContracts, fixtureRuntime),
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
          return (
        <IntegrationCard
          key={integration.id}
          {...integration}
          type={connectionCardType(status)}
          isConnected={status === 'connected'}
          onConnect={() => transition(integration.id, 'connect')}
          onDisconnect={() => transition(integration.id, 'disconnect')}
          onDocs={() => window.open(integration.docs, '_blank', 'noopener')}
        />
          )
        })()
      ))}
    </SimpleGrid>
  )
}
