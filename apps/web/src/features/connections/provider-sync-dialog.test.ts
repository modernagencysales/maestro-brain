import { describe, expect, it } from 'vitest'

import {
  selectSlackChannel,
  toggleScopeSelection,
} from './provider-sync-dialog'

describe('provider sync scope selection', () => {
  it('replaces the selected Slack channel', () => {
    const first = selectSlackChannel('C01', true)
    const second = selectSlackChannel('C02', true)

    expect(first).toEqual(['C01'])
    expect(second).toEqual(['C02'])
    expect(selectSlackChannel('C02', false)).toEqual([])
  })

  it('keeps Drive scope selection multi-folder', () => {
    const first = toggleScopeSelection([], 'folder-1', true)
    const second = toggleScopeSelection(first, 'folder-2', true)

    expect(second).toEqual(['folder-1', 'folder-2'])
    expect(toggleScopeSelection(second, 'folder-1', false)).toEqual([
      'folder-2',
    ])
  })
})
