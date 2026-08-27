import { describe, expect, it } from 'vitest'

import { toggleScopeSelection } from './provider-sync-dialog'

describe('provider sync scope selection', () => {
  it('keeps multiple Slack channels selected', () => {
    const first = toggleScopeSelection([], 'C01', true)
    const second = toggleScopeSelection(first, 'C02', true)

    expect(second).toEqual(['C01', 'C02'])
    expect(toggleScopeSelection(second, 'C01', false)).toEqual(['C02'])
  })

  it('does not duplicate a selected channel', () => {
    expect(toggleScopeSelection(['C01'], 'C01', true)).toEqual(['C01'])
  })
})
