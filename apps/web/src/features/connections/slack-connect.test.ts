import { describe, expect, it, vi } from 'vitest'

import {
  isLiveSlackOauthTransition,
  runSlackConnect,
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
