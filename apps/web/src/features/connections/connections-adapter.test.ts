import { describe, expect, it, vi } from 'vitest'

import {
  connectionCardType,
  connectionFixtures,
  connectionRuntimeMode,
  connectionStatusForCard,
  executeConnectionTransition,
  projectDurableConnectionStatus,
  transitionConnectionStatus,
  type ConnectionTransitionPorts,
  type DurableConnection,
} from './connections-adapter'

const durableConnection = (
  provider: DurableConnection['provider'] = 'slack',
  status: DurableConnection['status'] = 'active',
): DurableConnection => ({ provider, status, generation: 2 })

const transitionPorts = (): ConnectionTransitionPorts => ({
  beginIsolated: vi.fn(async (provider) => durableConnection(provider)),
  completeIsolated: vi.fn(async () => undefined),
  revokeIsolated: vi.fn(async () => undefined),
  invalidateIsolated: vi.fn(async () => undefined),
  beginLive: vi.fn(async () => undefined),
  revokeLive: vi.fn(async () => undefined),
  updateFixture: vi.fn(),
})

describe('Connections IntegrationCard adapter', () => {
  it('ships Maestro-relevant providers instead of upstream demo products', () => {
    expect(connectionFixtures.map(({ name }) => name)).toEqual([
      'Slack',
      'Google Drive',
      'HubSpot',
    ])
  })

  it('models connect and disconnect without changing the Pro card structure', () => {
    expect(transitionConnectionStatus('available', 'connect')).toBe(
      'connected',
    )
    expect(transitionConnectionStatus('connected', 'disconnect')).toBe(
      'available',
    )
  })

  it('projects durable backend states into the Pro card states', () => {
    expect(
      projectDurableConnectionStatus({
        provider: 'slack',
        status: 'verifying',
        generation: 2,
      }),
    ).toBe('connecting')
    expect(
      projectDurableConnectionStatus({
        provider: 'slack',
        status: 'active',
        generation: 2,
      }),
    ).toBe('connected')
    expect(
      projectDurableConnectionStatus(durableConnection('slack', 'authorizing')),
    ).toBe('connecting')
    expect(
      projectDurableConnectionStatus(durableConnection('slack', 'error')),
    ).toBe('error')
    expect(
      projectDurableConnectionStatus(durableConnection('slack', 'revoked')),
    ).toBe('available')
    expect(projectDurableConnectionStatus(undefined)).toBe('available')
  })

  it('selects the runtime and visible complete-card labels explicitly', () => {
    expect(connectionRuntimeMode(true, false)).toBe('isolated')
    expect(connectionRuntimeMode(false, true)).toBe('fixture')
    expect(connectionRuntimeMode(false, false)).toBe('live')
    expect(
      (['connected', 'connecting', 'error', 'available'] as const).map(
        connectionCardType,
      ),
    ).toEqual([
      'Connected',
      'Connecting',
      'Connection needs attention',
      'Available integration',
    ])
  })

  it('selects fixture and durable lifecycle state for each complete card', () => {
    expect(
      connectionStatusForCard({
        fixtureRuntime: true,
        fixtureStatuses: { slack: 'error' },
        provider: 'slack',
        liveConnections: [],
      }),
    ).toBe('error')
    expect(
      connectionStatusForCard({
        fixtureRuntime: true,
        fixtureStatuses: {},
        provider: 'hubspot',
        liveConnections: [],
      }),
    ).toBe('available')
    expect(
      connectionStatusForCard({
        fixtureRuntime: false,
        fixtureStatuses: {},
        provider: 'slack',
        liveConnections: [durableConnection()],
      }),
    ).toBe('connected')
  })

  it('runs the isolated begin, complete, revoke, and refresh lifecycle', async () => {
    const ports = transitionPorts()
    await executeConnectionTransition({
      mode: 'isolated',
      provider: 'slack',
      event: 'connect',
      liveConnections: [],
      ports,
    })
    expect(ports.beginIsolated).toHaveBeenCalledWith('slack')
    expect(ports.completeIsolated).toHaveBeenCalledWith('slack', 2)
    expect(ports.invalidateIsolated).toHaveBeenCalledTimes(1)

    await executeConnectionTransition({
      mode: 'isolated',
      provider: 'slack',
      event: 'disconnect',
      liveConnections: [durableConnection()],
      ports,
    })
    await executeConnectionTransition({
      mode: 'isolated',
      provider: 'hubspot',
      event: 'disconnect',
      liveConnections: [],
      ports,
    })
    expect(ports.revokeIsolated).toHaveBeenCalledWith('slack', 2)
    expect(ports.invalidateIsolated).toHaveBeenCalledTimes(3)
  })

  it('runs live and fixture transitions without crossing authorities', async () => {
    const ports = transitionPorts()
    await executeConnectionTransition({
      mode: 'live',
      provider: 'slack',
      event: 'connect',
      liveConnections: [],
      ports,
    })
    await executeConnectionTransition({
      mode: 'live',
      provider: 'slack',
      event: 'disconnect',
      liveConnections: [durableConnection()],
      ports,
    })
    await executeConnectionTransition({
      mode: 'live',
      provider: 'hubspot',
      event: 'disconnect',
      liveConnections: [],
      ports,
    })
    await executeConnectionTransition({
      mode: 'fixture',
      provider: 'google-drive',
      event: 'connect',
      liveConnections: [],
      ports,
    })
    expect(ports.beginLive).toHaveBeenCalledWith('slack')
    expect(ports.revokeLive).toHaveBeenCalledWith('slack', 2)
    expect(ports.updateFixture).toHaveBeenCalledWith('google-drive', 'connect')
    expect(ports.beginIsolated).not.toHaveBeenCalled()
  })
})
