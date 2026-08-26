import { describe, expect, it } from 'vitest'

import {
  buildTerminalCallbackUrl,
  parseLoopbackCallback,
} from './terminal-link'

describe('terminal link callback', () => {
  it('accepts only loopback HTTP callback origins', () => {
    expect(parseLoopbackCallback('http://127.0.0.1:43127/callback')?.origin).toBe(
      'http://127.0.0.1:43127',
    )
    expect(parseLoopbackCallback('http://localhost:43127/callback')).toBeTruthy()
    expect(parseLoopbackCallback('https://evil.example/callback')).toBeNull()
    expect(parseLoopbackCallback('http://192.168.1.2/callback')).toBeNull()
  })

  it('returns the linked credential and state to the local CLI', () => {
    expect(
      buildTerminalCallbackUrl({
        callback: 'http://127.0.0.1:43127/callback',
        state: 'state-123',
        displayKey: 'mtk_live_secret',
        workspaceSlug: 'apero',
        siteOrigin: 'https://brain.example',
      }),
    ).toBe(
      'http://127.0.0.1:43127/callback?state=state-123&key=mtk_live_secret&workspace=apero&origin=https%3A%2F%2Fbrain.example',
    )
  })
})
