export type StarterSearchResult = Readonly<{
  id: string
  title: string
  description: string
}>

export type AnswerCitation = Readonly<{
  citationKey: string
  sourceRevisionId: string
  title: string
  excerpt: string
  freshness: 'current' | 'review-due' | 'stale'
}>

export type GroundedAnswerResult = Readonly<{
  status: 'answered' | 'insufficient-context'
  answerMarkdown: string | null
  contextPack: Readonly<{
    schemaVersion: '3'
    freshness: 'current' | 'review-due' | 'stale' | 'unknown'
    citations: readonly AnswerCitation[]
  }>
}>

export const projectGroundedAnswerToSearchResults = (
  result: GroundedAnswerResult,
): StarterSearchResult[] => {
  if (result.status === 'insufficient-context') {
    return [
      {
        id: 'maestro-insufficient-context',
        title: 'Maestro · more context needed',
        description:
          'I could not find a current, exact Brain revision that supports an answer. Add or update a Brain page, then ask again.',
      },
    ]
  }

  return [
    {
      id: 'maestro-grounded-answer',
      title: `Maestro · ${result.contextPack.freshness}`,
      description: result.answerMarkdown ?? '',
    },
    ...result.contextPack.citations.map((citation, index) => ({
      id: citation.sourceRevisionId,
      title: `[${index + 1}] ${citation.title}`,
      description: `${citation.excerpt} · ${citation.freshness} · ${citation.citationKey}`,
    })),
  ]
}

export const askMaestroPromptFixtures = [
  'What needs my attention today?',
  'Summarize the latest client decisions',
  'Which client context is getting stale?',
] as const

export const fakeAskMaestroResult = (
  question: string,
): StarterSearchResult[] =>
  projectGroundedAnswerToSearchResults({
    status: 'answered',
    answerMarkdown: `This fake-safe preview demonstrates how Maestro answers “${question}” with a visible source revision. Live mode only uses eligible pages from the active workspace. [1]`,
    contextPack: {
      schemaVersion: '3',
      freshness: 'current',
      citations: [
        {
          citationKey: 'citation:fixture-brain-page:1',
          sourceRevisionId: 'brain-page:fixture-brain-page:revision:1',
          title: 'Demo Brain page',
          excerpt:
            'Fixture evidence is clearly labeled and never presented as live company knowledge.',
          freshness: 'current',
        },
      ],
    },
  })
