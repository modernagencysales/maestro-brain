import { describe, expect, it } from 'vitest'

import { slugForTitle } from './brain-page-create-dialog'

describe('Brain page create adapter', () => {
  it('creates a bounded URL-safe slug with a uniqueness suffix', () => {
    expect(slugForTitle('  Positioning & Proof!  ', 35)).toBe(
      'positioning-proof-z',
    )
    expect(slugForTitle('!@#', 36)).toBe('page-10')
    expect(slugForTitle('a'.repeat(80), 1)).toBe(`${'a'.repeat(48)}-1`)
  })
})
