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
  connectionFixtures,
  projectDurableConnectionStatus,
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
  ) => {
    if (isolatedContracts) {
      if (event === 'connect') {
        const begun = await runIsolatedHeadlessOperation<DurableConnection>({
          operationId: 'integrations.connections.begin',
          operationInput: { provider: id },
          idempotencyKey: `connect-${id}-${Date.now()}`,
        })
        await runIsolatedHeadlessOperation<DurableConnection>({
          operationId: 'integrations.connections.complete',
          operationInput: {
            provider: id,
            generation: begun.generation,
            completion: {
              status: 'active',
              connectionRef: `contract-${id}-${begun.generation}`,
            },
          },
          idempotencyKey: `complete-${id}-${begun.generation}`,
        })
      } else {
        const current = liveConnections.find(
          (connection) => connection.provider === id,
        )
        if (current !== undefined) {
          await runIsolatedHeadlessOperation<DurableConnection>({
            operationId: 'integrations.connections.revoke',
            operationInput: { provider: id, generation: current.generation },
            idempotencyKey: `revoke-${id}-${current.generation}`,
          })
        }
      }
      await queryClient.invalidateQueries({
        queryKey: ['provider-connections', 'isolated-contracts', workspace.id],
      })
      return
    }
    if (!fixtureRuntime) {
      if (event === 'connect') {
        await beginConnection({ workspaceId: workspace.id, provider: id })
        return
      }
      const current = liveConnections.find(
        (connection) => connection.provider === id,
      )
      if (current !== undefined) {
        await revokeConnection({
          workspaceId: workspace.id,
          provider: id,
          generation: current.generation,
        })
      }
      return
    }
    setStatuses((current) => ({
      ...current,
      [id]: transitionConnectionStatus(current[id] ?? 'available', event),
    }))
  }

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
      {connectionFixtures.map((integration) => (
        (() => {
          const status = fixtureRuntime
            ? (statuses[integration.id] ?? 'available')
            : projectDurableConnectionStatus(
                liveConnections.find(
                  (connection) => connection.provider === integration.id,
                ),
              )
          return (
        <IntegrationCard
          key={integration.id}
          {...integration}
          type={
            status === 'connected'
              ? 'Connected'
              : status === 'connecting'
                ? 'Connecting'
                : status === 'error'
                  ? 'Connection needs attention'
                  : 'Available integration'
          }
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
