'use client'

import {
  Button,
  ButtonGroup,
  GridList,
  IconButton,
  Section,
  Text,
  useClipboard,
} from '@saas-ui/react'
import { useConvexQuery } from '@convex-dev/react-query'
import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import { useMutation as useConvexMutation } from 'convex/react'
import { LuCheck, LuCopy, LuLaptop, LuX } from 'react-icons/lu'

import { LinkButton } from '@workspace/ui/button'
import { SettingsPage } from '@workspace/ui/settings-page'

import { useCurrentWorkspace } from '#features/common/hooks/use-current-workspace'
import { isFixtureAuthRuntime } from '#lib/auth/route-auth'

import { SettingsCard } from '../common/settings-card'

const setupCommand = 'npx --yes @modernagencysales/maestro-brain setup'

const listLinkedKeysRef = getFunctionReference(
  templateConfectRefs.public.headless.apiKeys.listLinkedKeys,
)
const revokeLinkedKeyRef = getFunctionReference(
  templateConfectRefs.public.headless.apiKeys.revokeLinkedKey,
)

type LinkedKey = Readonly<{
  id: string
  name: string
  displayPrefix: string
  status: 'active' | 'revoked' | 'expired'
  createdAt: number
}>

function SetupCommand() {
  const { copy, copied } = useClipboard({ value: setupCommand })

  return (
    <Section.Root>
      <Section.Header
        title="Connect a terminal"
        description="One command links the shared workspace and configures Codex, Claude Code, or Cowork."
      />
      <Section.Body>
        <SettingsCard
          footer={
            <Button variant="primary" onClick={copy}>
              {copied ? <LuCheck /> : <LuCopy />}
              {copied ? 'Copied' : 'Copy setup command'}
            </Button>
          }
        >
          <Text as="code" textStyle="sm">
            {setupCommand}
          </Text>
        </SettingsCard>
      </Section.Body>
    </Section.Root>
  )
}

function LinkedTerminal(props: {
  readonly terminal: LinkedKey
  readonly onRevoke: (id: string) => void
}) {
  return (
    <GridList.Item>
      <GridList.Cell>
        <LuLaptop />
      </GridList.Cell>
      <GridList.Cell flex="1">
        <Text textStyle="sm">{props.terminal.name}</Text>
        <Text color="fg.muted" textStyle="xs">
          {props.terminal.status} · {props.terminal.displayPrefix}… · linked{' '}
          {new Date(props.terminal.createdAt).toLocaleDateString()}
        </Text>
      </GridList.Cell>
      <GridList.Cell>
        <IconButton
          aria-label={`Revoke ${props.terminal.name}`}
          disabled={props.terminal.status !== 'active'}
          variant="ghost"
          onClick={() => props.onRevoke(props.terminal.id)}
        >
          <LuX />
        </IconButton>
      </GridList.Cell>
    </GridList.Item>
  )
}

function LinkedTerminals() {
  const [workspace] = useCurrentWorkspace()
  const fixtureRuntime = isFixtureAuthRuntime()
  const keys = useConvexQuery(
    listLinkedKeysRef,
    fixtureRuntime ? 'skip' : { workspaceId: workspace.id },
  ) as readonly LinkedKey[] | undefined
  const revoke = useConvexMutation(revokeLinkedKeyRef)

  return (
    <Section.Root>
      <Section.Header
        title="Linked terminals"
        description="Revoke a terminal immediately if it is lost or no longer used."
      />
      <Section.Body>
        <SettingsCard>
          {keys === undefined && !fixtureRuntime ? (
            <Text color="fg.muted">Loading linked terminals…</Text>
          ) : (keys?.length ?? 0) === 0 ? (
            <Text color="fg.muted">No terminals linked yet.</Text>
          ) : (
            <GridList.Root p="0">
              {keys?.map((terminal) => (
                <LinkedTerminal
                  key={terminal.id}
                  terminal={terminal}
                  onRevoke={(keyId) =>
                    void revoke({ workspaceId: workspace.id, keyId })
                  }
                />
              ))}
            </GridList.Root>
          )}
        </SettingsCard>
      </Section.Body>
    </Section.Root>
  )
}

export function AccountApiPage() {
  return (
    <SettingsPage
      title="Terminal & MCP"
      description="Connect terminal agents to this workspace and manage linked devices."
      actions={
        <ButtonGroup>
          <LinkButton href="/api/docs">API documentation</LinkButton>
        </ButtonGroup>
      }
    >
      <SetupCommand />
      <LinkedTerminals />
    </SettingsPage>
  )
}
