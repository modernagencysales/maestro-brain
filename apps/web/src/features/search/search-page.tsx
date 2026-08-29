'use client'

import {
  Avatar,
  Box,
  Button,
  EmptyState,
  GridList,
  Heading,
  HStack,
  LoadingOverlay,
  Page,
  Text,
  toast,
} from '@saas-ui/react'
import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import {
  useMutation as useTanstackMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useConvex, useMutation as useConvexMutation } from 'convex/react'
import * as React from 'react'
import {
  Link,
  linkOptions,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { LuSearch, LuX } from 'react-icons/lu'

import { SearchInput } from '@workspace/ui/search-input'

import { productShell } from '#config/product-shell'
import { useCurrentWorkspace } from '#features/common/hooks/use-current-workspace'
import { useWorkspaceSlug } from '#features/common/hooks/use-workspace-slug'
import { brainEvidenceRevisionRouteId } from '#features/contacts/inbox/brain-inbox-adapter'
import {
  isFixtureAuthRuntime,
  isIsolatedContractsRuntime,
} from '#lib/auth/route-auth'
import { runIsolatedHeadlessOperation } from '#lib/headless-api'

import {
  askMaestroPromptFixtures,
  fakeAskMaestroResult,
  projectGroundedAnswerToSearchResults,
  type GroundedAnswerResult,
  type StarterSearchResult,
} from './ask-maestro-adapter'

const answerQuestionRef = getFunctionReference(
  templateConfectRefs.public.capabilities.askCompanyBrain.askCompanyBrain,
)
const saveEvaluationExampleRef = getFunctionReference(
  templateConfectRefs.public.agents.assistant.saveEvaluationExample,
)

type SearchQueryData = Readonly<{
  results: StarterSearchResult[]
  answer?: GroundedAnswerResult
}>

export function SearchPage() {
  const navigate = useNavigate()
  const [workspace] = useCurrentWorkspace()
  const convex = useConvex()
  const isolatedContracts = isIsolatedContractsRuntime()
  const fixtureRuntime = isFixtureAuthRuntime() && !isolatedContracts

  const { q } = useSearch({
    from: '/_app/$workspace/_dashboard/search',
  })

  const setSearch = (q: string) => {
    navigate({
      from: '/$workspace/search',
      to: '.',
      search: {
        q,
      },
    })
  }

  const { data, error, isPending } = useQuery({
    queryKey: ['search', productShell.search, workspace.id, q],
    queryFn: async () => {
      if (productShell.search !== 'assistant') return { results: [] }
      if (isolatedContracts) {
        const result = await runIsolatedHeadlessOperation<GroundedAnswerResult>({
          operationId: 'brain.ask',
          operationInput: { question: q },
        })
        return {
          answer: result,
          results: projectGroundedAnswerToSearchResults(result),
        }
      }
      if (fixtureRuntime) {
        const results = fakeAskMaestroResult(q)
        return { results }
      }
      const result = await convex.query(answerQuestionRef, {
        workspaceId: workspace.id,
        question: q,
        evidenceMode: 'mixed',
      })
      return {
        answer: result,
        results: projectGroundedAnswerToSearchResults(result),
      }
    },
    enabled: !!q,
  })

  return (
    <Page.Root>
      <Page.Header
        display="block"
        minH="10"
        py="1"
        title={
          <SearchInput
            placeholder={
              productShell.search === 'assistant'
                ? 'Ask Maestro anything...'
                : 'Search your workspace...'
            }
            value={q}
            onChange={(e) => setSearch(e.target.value)}
            onReset={() => setSearch('')}
            width="full"
            border="0"
          />
        }
      />
      <Page.Body p="0">
        {q ? (
          isPending ? (
            <LoadingOverlay.Root>
              <LoadingOverlay.Spinner />
            </LoadingOverlay.Root>
          ) : (
            <Box>
              <SearchResults
                data={data?.results}
                error={error}
                search={q}
                workspace={workspace.slug}
                allowExactRevisionLinks={!fixtureRuntime && !isolatedContracts}
              />
              {data?.answer ? (
                <>
                  <ContextPackDetails answer={data.answer} />
                  {!isolatedContracts && !fixtureRuntime ? <AskFeedback
                    answer={data.answer}
                    question={q}
                    workspaceId={workspace.id}
                  /> : null}
                </>
              ) : null}
            </Box>
          )
        ) : (
          <RecentSearches />
        )}
      </Page.Body>
    </Page.Root>
  )
}

function RecentSearches() {
  const queryClient = useQueryClient()

  const workspace = useWorkspaceSlug()

  const { data, isLoading } = useQuery({
    queryKey: ['recent-searches', productShell.search],
    queryFn: async () => {
      return productShell.search === 'assistant'
        ? [...askMaestroPromptFixtures]
        : ['hello', 'james', 'kira']
    },
  })

  const clearRecent = useTanstackMutation({
    mutationFn: async () => {
      queryClient.setQueryData(['recent-searches', productShell.search], [])
    },
  })

  const getSearchLinkOptions = (q: string) =>
    linkOptions({
      to: '/$workspace/search',
      params: {
        workspace,
      },
      search: {
        q,
      },
    })

  if (!data?.length) {
    return null
  }

  return (
    <Box>
      <Heading as="h4" size="sm" color="fg.muted" px="5" py="2">
        {productShell.search === 'assistant'
          ? 'Try asking Maestro'
          : 'Recent searches'}
      </Heading>
      {isLoading ? (
        <LoadingOverlay.Root>
          <LoadingOverlay.Spinner />
        </LoadingOverlay.Root>
      ) : data.length > 0 ? (
        <GridList.Root interactive>
          {data.map((item) => (
            <GridList.Item key={item} textStyle="sm" px="5" py="2" asChild>
              <Link {...getSearchLinkOptions(item)} role="row">
                <GridList.Cell>
                  <LuSearch />
                </GridList.Cell>
                <GridList.Cell flex="1">
                  <Text>{item}</Text>
                </GridList.Cell>
              </Link>
            </GridList.Item>
          ))}
          {productShell.search === 'workspace' ? (
            <GridList.Item
              px="5"
              py="2"
              onClick={() => {
                clearRecent.mutate()
              }}
            >
              <GridList.Cell>
                <LuX />
              </GridList.Cell>
              <GridList.Cell flex="1" color="fg.subtle" textStyle="sm">
                Clear recent searches
              </GridList.Cell>
            </GridList.Item>
          ) : null}
        </GridList.Root>
      ) : null}
    </Box>
  )
}

function AskFeedback(props: {
  answer: GroundedAnswerResult
  question: string
  workspaceId: string
}) {
  const saveExample = useConvexMutation(saveEvaluationExampleRef)
  const [saving, setSaving] = React.useState<string | null>(null)

  const save = async (
    captureKind: 'feedback' | 'test',
    usefulness: 'useful' | 'needs-work' | 'unrated',
  ) => {
    const key = `${captureKind}:${usefulness}`
    setSaving(key)
    try {
      await saveExample({
        workspaceId: props.workspaceId,
        exampleKey: `web:${props.answer.contextPack.packHash}:${key}`,
        question: props.question,
        purpose: 'company-question',
        evidenceMode: props.answer.contextPack.evidenceMode,
        surface: 'web',
        answerStatus: props.answer.status,
        packHash: props.answer.contextPack.packHash,
        evidenceReferences: props.answer.contextPack.citations.map(
          ({ sourceKey, revisionKey, contentHash }) => ({
            sourceKey,
            revisionKey,
            contentHash,
          }),
        ),
        captureKind,
        usefulness,
        ...(usefulness === 'needs-work' ? { issueReason: 'other' } : {}),
      })
      toast.success({
        title:
          captureKind === 'test'
            ? 'Saved to the Brain test set'
            : 'Feedback saved',
      })
    } catch {
      toast.error({ title: 'Could not save Brain feedback' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <HStack px="5" py="3" gap="2" borderTopWidth="1px" wrap="wrap">
      <Text textStyle="sm" color="fg.muted" mr="2">
        Help improve shared company context
      </Text>
      <Button
        size="sm"
        variant="ghost"
        loading={saving === 'feedback:useful'}
        disabled={saving !== null}
        onClick={() => save('feedback', 'useful')}
      >
        Useful
      </Button>
      <Button
        size="sm"
        variant="ghost"
        loading={saving === 'feedback:needs-work'}
        disabled={saving !== null}
        onClick={() => save('feedback', 'needs-work')}
      >
        Needs work
      </Button>
      <Button
        size="sm"
        variant="outline"
        loading={saving === 'test:unrated'}
        disabled={saving !== null}
        onClick={() => save('test', 'unrated')}
      >
        Save as test
      </Button>
    </HStack>
  )
}

function SearchResults(props: {
  allowExactRevisionLinks: boolean
  data?: StarterSearchResult[]
  error?: Error | null
  search: string
  workspace: string
}) {
  if (props.error) {
    return (
      <EmptyState
        title="Company Brain unavailable"
        description="The Company Brain request failed. Try again, or use the CLI diagnostics if the problem continues."
      />
    )
  }

  if (props.search && !props.data?.length) {
    return (
      <EmptyState
        title={
          productShell.search === 'assistant' ? 'No answer yet' : 'No results'
        }
        description={`No results for query "${props.search}"`}
      />
    )
  }

  return (
    <Box>
      <Heading as="h4" size="sm" color="fg.muted" px="5" py="2">
        Results
      </Heading>
      <GridList.Root interactive>
        {props.data?.map((result) => {
          const revisionRouteId =
            props.allowExactRevisionLinks &&
            result.sourceKey &&
            result.revisionKey
              ? brainEvidenceRevisionRouteId(
                  result.sourceKey,
                  result.revisionKey,
                )
              : undefined
          const item = (
            <GridList.Item
              key={result.id}
              textStyle="sm"
              px="5"
              py="3"
              asChild={revisionRouteId !== undefined}
            >
              {revisionRouteId ? (
                <Link
                  to="/$workspace/inbox/$id"
                  params={{ workspace: props.workspace, id: revisionRouteId }}
                  search={{ contactId: revisionRouteId }}
                >
                  <GridList.Cell>
                    <Avatar name={result.title} size="2xs" />
                  </GridList.Cell>
                  <GridList.Cell flex="1">
                    <Text fontWeight="medium">{result.title}</Text>
                    <Text color="fg.muted">{result.description}</Text>
                    <Text color="fg.subtle" textStyle="xs" mt="1">
                      Open exact Brain revision
                    </Text>
                  </GridList.Cell>
                </Link>
              ) : (
                <>
                  <GridList.Cell>
                    <Avatar name={result.title} size="2xs" />
                  </GridList.Cell>
                  <GridList.Cell flex="1">
                    <Text fontWeight="medium">{result.title}</Text>
                    <Text color="fg.muted">{result.description}</Text>
                  </GridList.Cell>
                </>
              )}
            </GridList.Item>
          )
          return item
        })}
      </GridList.Root>
    </Box>
  )
}

function ContextPackDetails({ answer }: { answer: GroundedAnswerResult }) {
  const { contextPack } = answer
  const omissions = contextPack.omissions?.filter(({ count }) => count > 0) ?? []
  return (
    <Box px="5" py="3" borderTopWidth="1px">
      <HStack gap="3" wrap="wrap">
        <Text textStyle="xs" color="fg.muted">
          Evidence mode: {contextPack.evidenceMode.replace('_', ' ')}
        </Text>
        <Text textStyle="xs" color="fg.muted">
          Pack: {contextPack.packHash.slice(0, 20)}…
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {contextPack.claims?.length ?? 0} reviewed claims ·{' '}
          {contextPack.citations.length} exact citations
        </Text>
      </HStack>
      {contextPack.conflicts?.length ? (
        <Text textStyle="sm" color="orange.fg" mt="2">
          Possible conflict across {contextPack.conflicts.length} reviewed claim
          {contextPack.conflicts.length === 1 ? '' : 's'}; inspect the cited
          revisions before acting.
        </Text>
      ) : null}
      {omissions.length ? (
        <Text textStyle="xs" color="fg.muted" mt="2">
          Omitted: {omissions.map(({ reason, count }) => `${count} ${reason}`).join(', ')}
        </Text>
      ) : null}
    </Box>
  )
}
