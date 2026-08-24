export const shouldPersistBrainMarkdown = (input: {
  fixtureRuntime: boolean
  loadedMarkdown: string | undefined
  draftMarkdown: string
}): boolean =>
  !input.fixtureRuntime &&
  input.loadedMarkdown !== undefined &&
  input.draftMarkdown !== input.loadedMarkdown

export type BrainSaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'conflict'
  | 'error'

const taggedError = (error: unknown, depth = 0): string | undefined => {
  if (depth >= 3) return undefined
  if (typeof error !== 'object' || error === null) return undefined
  if ('_tag' in error && typeof error._tag === 'string') return error._tag
  if ('data' in error) return taggedError(error.data, depth + 1)
  if ('cause' in error) return taggedError(error.cause, depth + 1)
  return undefined
}

export const classifyBrainSaveFailure = (error: unknown): BrainSaveState =>
  taggedError(error) === 'StaleRevision' ? 'conflict' : 'error'
