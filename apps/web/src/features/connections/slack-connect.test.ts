import { describe, expect, it, vi } from 'vitest'

import { runSlackConnect } from './slack-connect'

describe('runSlackConnect', () => {
  it('runs begin, browser OAuth, and completion in order', async () => {
    const begin = vi.fn().mockResolvedValue({
      connectSessionToken: 'connect_token',
      expiresAt: Date.now() + 60_000,
      connectSessionId: 'session_2',
    })
    const open = vi.fn().mockResolvedValue({ connectionId: 'connection_1' })
    const complete = vi.fn().mockResolvedValue(undefined)

    await runSlackConnect({ begin, open, complete })

    expect(open).toHaveBeenCalledWith({
      connectSessionToken: 'connect_token',
    })
    expect(complete).toHaveBeenCalledWith({
      connectionId: 'connection_1',
      connectSessionId: 'session_2',
    })
  })

  it('does not complete when the user closes OAuth', async () => {
    const complete = vi.fn()
    await expect(
      runSlackConnect({
        begin: vi.fn().mockResolvedValue({
          connectSessionToken: 'connect_token',
          expiresAt: Date.now() + 60_000,
          connectSessionId: 'session_1',
        }),
        open: vi.fn().mockRejectedValue({ _tag: 'NangoConnectCancelled' }),
        complete,
      }),
    ).resolves.toBeUndefined()
    expect(complete).not.toHaveBeenCalled()
  })
})
