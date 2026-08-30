'use client'

import * as React from 'react'

import { createListCollection } from '@chakra-ui/react'
import { Button, Card, Field, Heading, Select, Stack, Text } from '@saas-ui/react'
import {
  getFunctionReference,
  templateConfectRefs,
} from '@maestro-template/convex/refs'
import { useMutation as useConvexMutation } from 'convex/react'

import { useWorkspaces } from '#features/common/hooks/use-workspaces'
import { configuredBrainApiOrigin } from '#lib/brain-proxy'

import {
  buildTerminalCallbackUrl,
  parseLoopbackCallback,
  selectTerminalWorkspaceId,
} from './terminal-link'

const createLinkedKeyRef = getFunctionReference(
  templateConfectRefs.public.headless.apiKeys.createLinkedKey,
)

export function TerminalLinkPage(props: {
  readonly callback: string
  readonly state: string
}) {
  const workspaces = useWorkspaces()
  const [workspaceId, setWorkspaceId] = React.useState(
    () => workspaces[0]?.id ?? '',
  )
  const [error, setError] = React.useState<string>()
  const [linking, setLinking] = React.useState(false)
  const createLinkedKey = useConvexMutation(createLinkedKeyRef)
  const callbackIsValid = parseLoopbackCallback(props.callback) !== null
  const selectedWorkspaceId = selectTerminalWorkspaceId(
    workspaces,
    workspaceId,
  )
  const selectedWorkspace = workspaces.find(
    ({ id }) => id === selectedWorkspaceId,
  )
  const workspaceCollection = createListCollection({
    items: workspaces.map((workspace) => ({
      value: workspace.id,
      label: workspace.label,
    })),
  })

  const link = async () => {
    const workspace = workspaces.find(({ id }) => id === selectedWorkspaceId)
    if (!workspace || !callbackIsValid) return
    setLinking(true)
    setError(undefined)
    try {
      const platform = navigator.platform?.trim() || 'Terminal'
      const created = await createLinkedKey({
        workspaceId: workspace.id,
        name: `${platform} — Maestro Brain`,
      })
      const apiOrigin = configuredBrainApiOrigin()
      if (apiOrigin === undefined) throw new Error('Brain API is not configured.')
      window.location.replace(
        buildTerminalCallbackUrl({
          callback: props.callback,
          state: props.state,
          displayKey: created.displayKey,
          workspaceSlug: workspace.slug,
          siteOrigin: apiOrigin,
        }),
      )
    } catch (cause) {
      setLinking(false)
      setError(cause instanceof Error ? cause.message : 'Could not link terminal.')
    }
  }

  return (
    <Card.Root width="full" maxW="xl">
      <Card.Header>
        <Stack gap="1">
          <Heading size="lg">Connect Maestro Brain</Heading>
          <Text color="fg.muted">
            Link this terminal to the shared company workspace. No workspace IDs
            or API keys need to be copied.
          </Text>
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack gap="5">
          {!callbackIsValid ? (
            <Text role="alert" color="fg.error">
              The setup request did not contain a valid local terminal callback.
              Run maestro-brain setup again.
            </Text>
          ) : null}
          {workspaces.length === 0 ? (
            <Text role="alert">
              You do not belong to a workspace yet. Accept the Apero invitation,
              then return to this page.
            </Text>
          ) : (
            <Field.Root>
              <Field.Label>Company workspace</Field.Label>
              <Select.Root
                aria-label="Company workspace"
                collection={workspaceCollection}
                value={[selectedWorkspaceId]}
                onValueChange={({ value }) => setWorkspaceId(value[0] ?? '')}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Choose a workspace" />
                </Select.Trigger>
                <Select.Content portalled={false}>
                  {workspaceCollection.items.map((workspace) => (
                    <Select.Item key={workspace.value} item={workspace}>
                      {workspace.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <Field.HelperText>
                The terminal credential is bound to this workspace automatically.
              </Field.HelperText>
            </Field.Root>
          )}
          {error ? (
            <Text role="alert" color="fg.error">
              {error}
            </Text>
          ) : null}
          <Button
            alignSelf="start"
            disabled={!callbackIsValid || !selectedWorkspaceId || linking}
            loading={linking}
            onClick={() => void link()}
          >
            {selectedWorkspace
              ? `Connect terminal to ${selectedWorkspace.label}`
              : 'Choose a workspace'}
          </Button>
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}
