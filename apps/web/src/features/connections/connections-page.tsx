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

const cardType = (status: ConnectionStatus) => {
  if (status === 'connected') return 'Connected'
  if (status === 'connecting') return 'Connecting'
  if (status === 'error') return 'Connection needs attention'
  return 'Available integration'
}

const transition = async (input: {
  id: ConnectionCardModel['id']
  event: 'connect' | 'disconnect'
  fixtureRuntime: boolean
  setStatuses: React.Dispatch<
    React.SetStateAction<Record<string, ConnectionStatus>>
  >
  beginSlackConnect: (args: Record<string, never>) => Promise<{
    connectSessionId: string
    connectSessionToken: string
    expiresAt: number
  }>
  completeSlackConnect: (args: {
    connectionId: string
    connectSessionId: string
  }) => Promise<unknown>
}) => {
  if (input.fixtureRuntime) {
    input.setStatuses((current) => ({
      ...current,
      [input.id]: transitionConnectionStatus(
        current[input.id] ?? 'available',
        input.event,
      ),
    }))
    return
  }
  if (input.id === 'slack' && input.event === 'connect') {
    await runSlackConnect({
      begin: () => input.beginSlackConnect({}),
      open: openNangoConnect,
      complete: input.completeSlackConnect,
    })
    return
  }
  input.setStatuses((current) => ({
    ...current,
    [input.id]: input.event === 'connect' ? 'connected' : 'available',
  }))
}

const ConnectionCard = (props: {
  integration: ConnectionCardModel
  status: ConnectionStatus
  onTransition: (event: 'connect' | 'disconnect') => Promise<void>
}) => (
  <IntegrationCard
    {...props.integration}
    type={cardType(props.status)}
    isConnected={props.status === 'connected'}
    onConnect={() => props.onTransition('connect')}
    onDisconnect={() => props.onTransition('disconnect')}
    onDocs={() => window.open(props.integration.docs, '_blank', 'noopener')}
  />
)

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

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
      {connectionFixtures.map((integration) => {
        const status =
            !fixtureRuntime && integration.id === 'slack'
              ? projectLegacySlackStatus(slackStatus?.status)
              : (statuses[integration.id] ?? 'available')
        return (
          <ConnectionCard
          key={integration.id}
            integration={integration}
            status={status}
            onTransition={(event) =>
              transition({
                id: integration.id,
                event,
                fixtureRuntime,
                setStatuses,
                beginSlackConnect,
                completeSlackConnect,
              })
            }
          />
        )
      })}
    </SimpleGrid>
  )
}
