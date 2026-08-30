import { describe, expect, it } from 'vitest'

import {
  buildTerminalCallbackUrl,
  parseLoopbackCallback,
  selectTerminalWorkspaceId,
  terminalLinkSearchSchema,
} from './terminal-link'

describe('terminal link callback', () => {
  it('prefers Apero but requires a choice for unrelated multi-workspace users', () => {
    const multiple = [
      { id: 'client-1', slug: 'client-one' },
      { id: 'apero-1', slug: 'apero' },
    ]
    expect(selectTerminalWorkspaceId(multiple, '')).toBe('apero-1')
    expect(selectTerminalWorkspaceId(multiple, 'client-1')).toBe('client-1')
    expect(
      selectTerminalWorkspaceId(
        [
          { id: 'client-1', slug: 'client-one' },
          { id: 'client-2', slug: 'client-two' },
        ],
        '',
      ),
    ).toBe('')
    expect(
      selectTerminalWorkspaceId([{ id: 'only-1', slug: 'only' }], ''),
    ).toBe('only-1')
  })

  it('turns incomplete browser links into a renderable invalid request', () => {
    expect(terminalLinkSearchSchema.parse({})).toEqual({
      callback: '',
      state: '',
    })
    expect(
      terminalLinkSearchSchema.parse({
        callback: 'not-a-url',
        state: 'short',
      }),
    ).toEqual({ callback: 'not-a-url', state: '' })
  })

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
