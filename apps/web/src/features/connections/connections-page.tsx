import React from 'react'

import { SimpleGrid } from '@chakra-ui/react'
import { openNangoConnect } from '@maestro-template/integrations/nango/connectBrowser'
import { useAction as useConvexAction, useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { IntegrationCard } from '#components/integration-card/integration-card'
import { isFixtureAuthRuntime } from '#lib/auth/route-auth'

import {
  connectionFixtures,
  projectLegacySlackStatus,
  transitionConnectionStatus,
  type ConnectionCardModel,
  type ConnectionStatus,
} from './connections-adapter'
import { runSlackConnect } from './slack-connect'

type SlackStatus = Readonly<{
  status:
    | 'not_connected'
    | 'authorizing'
    | 'verifying'
    | 'active'
    | 'error'
    | 'reauthorizing'
    | 'revoked'
}>

const slackStatusRef = makeFunctionReference<'query', Record<string, never>, SlackStatus>(
  'integrations/slackConnections:getSlackConnectionStatus',
)
const beginSlackConnectRef = makeFunctionReference<
  'action',
  Record<string, never>,
  { connectSessionId: string; connectSessionToken: string; expiresAt: number }
>('integrations/slackConnections:beginSlackConnect')
const completeSlackConnectRef = makeFunctionReference<
  'action',
  { connectionId: string; connectSessionId: string },
  unknown
>('integrations/slackConnections:completeSlackConnect')

/** Exact Pro IntegrationCard story composition with an installed import seam. */
export const ConnectionsPage = () => {
  const fixtureRuntime = isFixtureAuthRuntime()
  // The staging backend still owns the proven Slack ingestion pipeline. Keep
  // the canonical card on that contract until its tables migrate in place.
  const slackStatus = useQuery(slackStatusRef, fixtureRuntime ? 'skip' : {})
  const beginSlackConnect = useConvexAction(beginSlackConnectRef)
  const completeSlackConnect = useConvexAction(completeSlackConnectRef)
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
    if (!fixtureRuntime) {
      if (event === 'connect') {
        if (id === 'slack') {
          await runSlackConnect({
            begin: () => beginSlackConnect({}),
            open: openNangoConnect,
            complete: ({ connectionId, connectSessionId }) =>
              completeSlackConnect({
                connectionId,
                connectSessionId,
              }),
          })
          return
        }
        setStatuses((current) => ({ ...current, [id]: 'connected' }))
        return
      }
      setStatuses((current) => ({ ...current, [id]: 'available' }))
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
          const status =
            !fixtureRuntime && integration.id === 'slack'
              ? projectLegacySlackStatus(slackStatus?.status)
              : (statuses[integration.id] ?? 'available')
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
