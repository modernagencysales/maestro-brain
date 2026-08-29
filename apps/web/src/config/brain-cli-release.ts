export const brainCliRelease = {
  version: '0.1.4',
  tag: 'brain-cli-v0.1.4',
  asset: 'maestro-brain.tgz',
} as const

export const brainCliReleaseUrl =
  `https://github.com/modernagencysales/maestro-brain/releases/download/${brainCliRelease.tag}/${brainCliRelease.asset}`

export const brainCliSetupCommand = `npx --yes ${brainCliReleaseUrl} setup`
