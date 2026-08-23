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

export const classifyBrainSaveFailure = (error: unknown): BrainSaveState =>
  typeof error === 'object' &&
  error !== null &&
  '_tag' in error &&
  error._tag === 'StaleRevision'
    ? 'conflict'
    : 'error'
