import { z } from 'zod'

export const terminalLinkSearchSchema = z.object({
  callback: z.string().catch(''),
  state: z.string().min(16).catch(''),
})

export const parseLoopbackCallback = (value: string): URL | null => {
  try {
    const callback = new URL(value)
    const loopback =
      callback.hostname === '127.0.0.1' || callback.hostname === 'localhost'
    return callback.protocol === 'http:' && loopback ? callback : null
  } catch {
    return null
  }
}

export const selectTerminalWorkspaceId = (
  workspaces: readonly { readonly id: string; readonly slug: string }[],
  selectedId: string,
): string => {
  if (workspaces.some(({ id }) => id === selectedId)) return selectedId
  const apero = workspaces.find(({ slug }) => slug === 'apero')
  return apero?.id ?? (workspaces.length === 1 ? (workspaces[0]?.id ?? '') : '')
}

export const buildTerminalCallbackUrl = (input: {
  readonly callback: string
  readonly state: string
  readonly displayKey: string
  readonly workspaceSlug: string
  readonly siteOrigin: string
}): string => {
  const callback = parseLoopbackCallback(input.callback)
  if (callback === null) throw new Error('Terminal callback must use localhost.')
  callback.searchParams.set('state', input.state)
  callback.searchParams.set('key', input.displayKey)
  callback.searchParams.set('workspace', input.workspaceSlug)
  callback.searchParams.set('origin', new URL(input.siteOrigin).origin)
  return callback.toString()
}
