import { describe, expect, it, vi } from 'vitest'

import {
  isLiveSlackOauthTransition,
  runSlackConnect,
  runSlackSyncWithFeedback,
  slackSyncErrorMessage,
} from './slack-connect'

describe('runSlackConnect', () => {
  it('selects OAuth only for a live Slack connect', () => {
    expect(
      isLiveSlackOauthTransition({
        mode: 'live',
        provider: 'slack',
        event: 'connect',
      }),
    ).toBe(true)
    expect(
      isLiveSlackOauthTransition({
        mode: 'fixture',
        provider: 'slack',
        event: 'connect',
      }),
    ).toBe(false)
  })

  it('runs begin, browser OAuth, and completion in order', async () => {
    const begin = vi.fn().mockResolvedValue({
      connectSessionToken: 'connect_token',
      expiresAt: Date.now() + 60_000,
      generation: 2,
    })
    const open = vi.fn().mockResolvedValue({ connectionId: 'connection_1' })
    const complete = vi.fn().mockResolvedValue(undefined)

    await runSlackConnect({ begin, open, complete })

    expect(open).toHaveBeenCalledWith({
      connectSessionToken: 'connect_token',
    })
    expect(complete).toHaveBeenCalledWith({
      connectionId: 'connection_1',
      generation: 2,
    })
  })

  it('does not complete when the user closes OAuth', async () => {
    const complete = vi.fn()
    await expect(
      runSlackConnect({
        begin: vi.fn().mockResolvedValue({
          connectSessionToken: 'connect_token',
          expiresAt: Date.now() + 60_000,
          generation: 1,
        }),
        open: vi.fn().mockRejectedValue({ _tag: 'NangoConnectCancelled' }),
        complete,
      }),
    ).resolves.toBeUndefined()
    expect(complete).not.toHaveBeenCalled()
  })
})

describe('runSlackSyncWithFeedback', () => {
  it('surfaces a failed sync without turning a completed OAuth flow into a rejection', async () => {
    const onError = vi.fn()

    await expect(
      runSlackSyncWithFeedback({
        sync: vi.fn().mockRejectedValue(new Error('sync failed')),
        onError,
      }),
    ).resolves.toBeUndefined()

    expect(onError).toHaveBeenCalledOnce()
  })

  it('does not report successful syncs as failures', async () => {
    const onError = vi.fn()

    await runSlackSyncWithFeedback({
      sync: vi.fn().mockResolvedValue(undefined),
      onError,
    })

    expect(onError).not.toHaveBeenCalled()
  })
})

describe('slackSyncErrorMessage', () => {
  it('surfaces actionable provider validation messages', () => {
    expect(
      slackSyncErrorMessage({
        data: {
          _tag: 'ValidationFailed',
          field: 'channelIds',
          message: 'Invite Maestro Brain to the private channel, then sync again.',
        },
      }),
    ).toBe('Invite Maestro Brain to the private channel, then sync again.')
  })

  it('falls back for unknown failures', () => {
    expect(slackSyncErrorMessage(new Error('network failed'))).toBe(
      'Check the approved Slack channels and try again.',
    )
  })
})
