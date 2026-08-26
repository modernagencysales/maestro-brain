import type { IconType } from 'react-icons'
import { FaGoogleDrive, FaSlack } from 'react-icons/fa6'
import { SiHubspot } from 'react-icons/si'

export type ConnectionStatus =
  | 'available'
  | 'connecting'
  | 'connected'
  | 'error'

export type DurableConnection = Readonly<{
  provider: ConnectionCardModel['id']
  status: 'authorizing' | 'verifying' | 'active' | 'error' | 'revoked'
  generation: number
  syncStatus?: 'syncing' | 'ready' | 'error'
  lastSyncedAt?: number
  lastSyncMessageCount?: number
  lastSyncPageCount?: number
  lastSyncSourceCount?: number
}>

export type EvidenceProviderHealth = Readonly<{
  provider: 'brain_page' | 'slack' | 'google_drive' | 'hubspot' | 'transcript'
  activeSourceCount: number
  currentEntryCount: number
  coverageState: string
  lastConnectorRun: Readonly<{
    status: 'running' | 'complete' | 'failed'
    updatedAt: number
  }> | null
}>

export type ConnectionCardModel = Readonly<{
  id: 'slack' | 'google-drive' | 'hubspot'
  name: string
  description: string
  icon: IconType
  docs: string
  status: ConnectionStatus
}>

export type ConnectionRuntimeMode = 'isolated' | 'live' | 'fixture'

export type ConnectionTransitionPorts = Readonly<{
  beginIsolated: (
    provider: ConnectionCardModel['id'],
  ) => Promise<DurableConnection>
  completeIsolated: (
    provider: ConnectionCardModel['id'],
    generation: number,
  ) => Promise<unknown>
  revokeIsolated: (
    provider: ConnectionCardModel['id'],
    generation: number,
  ) => Promise<unknown>
  invalidateIsolated: () => Promise<unknown>
  beginLive: (provider: ConnectionCardModel['id']) => Promise<unknown>
  revokeLive: (
    provider: ConnectionCardModel['id'],
    generation: number,
  ) => Promise<unknown>
  updateFixture: (
    provider: ConnectionCardModel['id'],
    event: 'connect' | 'disconnect',
  ) => void
}>

export const connectionFixtures: readonly ConnectionCardModel[] = [
  {
    id: 'slack',
    name: 'Slack',
    description:
      'Bring client conversations and channel context into the Agency Brain.',
    icon: FaSlack,
    docs: 'https://api.slack.com/docs',
    status: 'connected',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description:
      'Use approved documents and folders as source material for client work.',
    icon: FaGoogleDrive,
    docs: 'https://developers.google.com/drive',
    status: 'available',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description:
      'Connect customer and pipeline context without copying it into a second UI.',
    icon: SiHubspot,
    docs: 'https://developers.hubspot.com/docs',
    status: 'available',
  },
]

export const transitionConnectionStatus = (
  status: ConnectionStatus,
  event: 'connect' | 'disconnect',
): ConnectionStatus => (event === 'connect' ? 'connected' : 'available')

export const connectionRuntimeMode = (
  isolatedContracts: boolean,
  fixtureRuntime: boolean,
): ConnectionRuntimeMode =>
  isolatedContracts ? 'isolated' : fixtureRuntime ? 'fixture' : 'live'

export const connectionCardType = (status: ConnectionStatus): string => {
  if (status === 'connected') return 'Connected'
  if (status === 'connecting') return 'Connecting'
  if (status === 'error') return 'Connection needs attention'
  return 'Available integration'
}

export const connectionStatusForCard = (input: {
  readonly fixtureRuntime: boolean
  readonly fixtureStatuses: Readonly<Record<string, ConnectionStatus>>
  readonly provider: ConnectionCardModel['id']
  readonly liveConnections: readonly DurableConnection[]
}): ConnectionStatus =>
  input.fixtureRuntime
    ? (input.fixtureStatuses[input.provider] ?? 'available')
    : projectDurableConnectionStatus(
        input.liveConnections.find(
          (connection) => connection.provider === input.provider,
        ),
      )

export const executeConnectionTransition = async (input: {
  readonly mode: ConnectionRuntimeMode
  readonly provider: ConnectionCardModel['id']
  readonly event: 'connect' | 'disconnect'
  readonly liveConnections: readonly DurableConnection[]
  readonly ports: ConnectionTransitionPorts
}): Promise<void> => {
  if (input.mode === 'isolated') {
    if (input.event === 'connect') {
      const begun = await input.ports.beginIsolated(input.provider)
      await input.ports.completeIsolated(input.provider, begun.generation)
    } else {
      const current = input.liveConnections.find(
        (connection) => connection.provider === input.provider,
      )
      if (current !== undefined) {
        await input.ports.revokeIsolated(
          input.provider,
          current.generation,
        )
      }
    }
    await input.ports.invalidateIsolated()
    return
  }

  if (input.mode === 'live') {
    if (input.event === 'connect') {
      await input.ports.beginLive(input.provider)
      return
    }
    const current = input.liveConnections.find(
      (connection) => connection.provider === input.provider,
    )
    if (current !== undefined) {
      await input.ports.revokeLive(input.provider, current.generation)
    }
    return
  }

  input.ports.updateFixture(input.provider, input.event)
}

export const projectDurableConnectionStatus = (
  connection: DurableConnection | undefined,
): ConnectionStatus => {
  if (connection?.status === 'active') return 'connected'
  if (
    connection?.status === 'authorizing' ||
    connection?.status === 'verifying'
  ) {
    return 'connecting'
  }
  if (connection?.status === 'error') return 'error'
  return 'available'
}
