import { describe, expect, it } from 'vitest'

import {
  askMaestroPromptFixtures,
  projectGroundedAnswerToSearchResults,
} from './ask-maestro-adapter'

describe('assistant to Starter Search adapter', () => {
  it('projects the answer and exact citations into Starter results', () => {
    expect(
      projectGroundedAnswerToSearchResults({
        status: 'answered',
        answerMarkdown: 'The launch is Friday. [1]',
        contextPack: {
          schemaVersion: '3',
          freshness: 'current',
          citations: [
            {
              citationKey: 'citation:page-1:42',
              sourceRevisionId: 'brain-page:page-1:revision:42',
              title: 'Launch plan',
              excerpt: 'The launch is Friday.',
              freshness: 'current',
            },
          ],
        },
      }),
    ).toEqual([
      {
        id: 'maestro-grounded-answer',
        title: 'Maestro · current',
        description: 'The launch is Friday. [1]',
      },
      {
        id: 'brain-page:page-1:revision:42',
        title: '[1] Launch plan',
        description:
          'The launch is Friday. · current · citation:page-1:42',
      },
    ])
  })

  it('projects typed abstention without pretending there is an answer', () => {
    expect(
      projectGroundedAnswerToSearchResults({
        status: 'insufficient-context',
        answerMarkdown: null,
        contextPack: {
          schemaVersion: '3',
          freshness: 'unknown',
          citations: [],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'maestro-insufficient-context',
        title: 'Maestro · more context needed',
      }),
    ])
  })

  it('ships useful fake-safe prompt ideas', () => {
    expect(askMaestroPromptFixtures).toContain('What needs my attention today?')
  })
})
