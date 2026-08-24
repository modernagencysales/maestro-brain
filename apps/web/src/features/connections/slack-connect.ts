type BeginResult = Readonly<{
  connectSessionToken: string
  expiresAt: number
  generation: number
}>

type OpenNangoConnect = (input: {
  readonly connectSessionToken: string
}) => Promise<{ readonly connectionId: string }>

export const isLiveSlackOauthTransition = (input: {
  readonly mode: 'isolated' | 'live' | 'fixture'
  readonly provider: 'slack' | 'google-drive' | 'hubspot'
  readonly event: 'connect' | 'disconnect'
}): boolean =>
  input.mode === 'live' &&
  input.provider === 'slack' &&
  input.event === 'connect'

export const runSlackConnect = async (input: {
  readonly begin: () => Promise<BeginResult>
  readonly open: OpenNangoConnect
  readonly complete: (input: {
    connectionId: string
    generation: number
  }) => Promise<unknown>
}) => {
  const session = await input.begin()
  if (session.expiresAt <= Date.now()) {
    throw new Error('Slack authorization expired. Try again.')
  }
  try {
    const connected = await input.open({
      connectSessionToken: session.connectSessionToken,
    })
    await input.complete({
      connectionId: connected.connectionId,
      generation: session.generation,
    })
  } catch (error) {
    if ((error as { readonly _tag?: unknown })._tag === 'NangoConnectCancelled') {
      return
    }
    throw error
  }
}
