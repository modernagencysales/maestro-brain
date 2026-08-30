import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { brainCliRelease, brainCliReleaseUrl } from './brain-cli-release'

const rootFile = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

describe('Brain CLI release consistency', () => {
  it('keeps package, runtime, web, and onboarding surfaces on one version', () => {
    const packageJson = JSON.parse(
      rootFile('apps/brain-cli/package.json'),
    ) as { version: string }
    const versionSource = rootFile('apps/brain-cli/src/version.ts')
    const cliReadme = rootFile('apps/brain-cli/README.md')
    const onboarding = rootFile('docs/team-onboarding.md')

    expect(brainCliRelease.version).toBe(packageJson.version)
    expect(brainCliRelease.tag).toBe(`brain-cli-v${packageJson.version}`)
    expect(versionSource).toContain(
      `export const cliVersion = "${packageJson.version}"`,
    )
    expect(brainCliReleaseUrl).toContain(
      `/brain-cli-v${packageJson.version}/maestro-brain.tgz`,
    )
    expect(cliReadme).toContain(brainCliReleaseUrl)
    expect(onboarding).toContain(brainCliReleaseUrl)
  })
})
