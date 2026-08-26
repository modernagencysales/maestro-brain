import { describe, expect, it } from 'vitest'

import { setupCommand } from './account-api-page'

describe('terminal setup command', () => {
  it('runs the public CLI release instead of the unpublished npm package', () => {
    expect(setupCommand).toBe(
      'npx --yes https://github.com/modernagencysales/maestro-brain/releases/latest/download/maestro-brain.tgz setup',
    )
    expect(setupCommand).not.toContain('@modernagencysales/maestro-brain')
  })
})
