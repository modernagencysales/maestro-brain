import { describe, expect, it } from 'vitest'

import {
  classifyBrainSaveFailure,
  shouldPersistBrainMarkdown,
} from './brain-page-editor-state'

describe('Brain page editor persistence decision', () => {
  it('saves only changed live pages', () => {
    expect(
      shouldPersistBrainMarkdown({
        fixtureRuntime: false,
        loadedMarkdown: '# current',
        draftMarkdown: '# changed',
      }),
    ).toBe(true)
    expect(
      shouldPersistBrainMarkdown({
        fixtureRuntime: true,
        loadedMarkdown: '# current',
        draftMarkdown: '# changed',
      }),
    ).toBe(false)
    expect(
      shouldPersistBrainMarkdown({
        fixtureRuntime: false,
        loadedMarkdown: '# current',
        draftMarkdown: '# current',
      }),
    ).toBe(false)
  })

  it('distinguishes stale revision conflicts from transport failures', () => {
    expect(classifyBrainSaveFailure({ _tag: 'StaleRevision' })).toBe('conflict')
    expect(
      classifyBrainSaveFailure({ data: { _tag: 'StaleRevision' } }),
    ).toBe('conflict')
    expect(
      classifyBrainSaveFailure({ cause: { data: { _tag: 'StaleRevision' } } }),
    ).toBe('conflict')
    expect(classifyBrainSaveFailure(new Error('offline'))).toBe('error')
  })
})
