type BeginResult = Readonly<{
  connectSessionToken: string
  expiresAt: number
  connectSessionId: string
}>

type OpenNangoConnect = (input: {
  readonly connectSessionToken: string
}) => Promise<{ readonly connectionId: string }>

export const runSlackConnect = async (input: {
  readonly begin: () => Promise<BeginResult>
  readonly open: OpenNangoConnect
  readonly complete: (input: {
    connectionId: string
    connectSessionId: string
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
      connectSessionId: session.connectSessionId,
    })
  } catch (error) {
    if ((error as { readonly _tag?: unknown })._tag === 'NangoConnectCancelled') {
      return
    }
    throw error
  }
}
