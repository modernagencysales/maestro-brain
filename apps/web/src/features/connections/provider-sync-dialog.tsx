'use client'

import * as React from 'react'
import {
  Box,
  Field,
  Input,
  NativeSelect,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react'
import { Button, Dialog } from '@saas-ui/react'
import { Checkbox } from '#components/ui/checkbox'

export type SyncProvider = 'slack' | 'google-drive' | 'hubspot'

export type ProviderScopeDiscovery = Readonly<{
  provider: SyncProvider
  containers: readonly Readonly<{ id: string; label: string }>[]
  scopes: readonly Readonly<{
    id: string
    label: string
    description?: string
  }>[]
  resolvedContainerId?: string
}>

export const toggleScopeSelection = (
  current: readonly string[],
  scopeId: string,
  checked: boolean,
): string[] =>
  checked
    ? [...new Set([...current, scopeId])]
    : current.filter((id) => id !== scopeId)

export const selectSlackChannel = (
  scopeId: string,
  checked: boolean,
): string[] => (checked ? [scopeId] : [])

export function ProviderSyncDialog(props: {
  open: boolean
  provider: SyncProvider | null
  initialContainerId?: string
  initialRootFolderIds?: readonly string[]
  initialChannelIds?: readonly string[]
  onClose: () => void
  onDiscover: (
    provider: SyncProvider,
    containerId?: string,
  ) => Promise<ProviderScopeDiscovery>
  onSync: (input: {
    provider: SyncProvider
    containerId: string
    rootFolderIds: readonly string[]
    channelIds: readonly string[]
    lookbackDays: number
  }) => Promise<void>
}) {
  const [containerId, setContainerId] = React.useState('')
  const [selectedScopeIds, setSelectedScopeIds] = React.useState<string[]>([])
  const [manualScopes, setManualScopes] = React.useState('')
  const [discovery, setDiscovery] = React.useState<ProviderScopeDiscovery>()
  const [discovering, setDiscovering] = React.useState(false)
  const [discoveryFailed, setDiscoveryFailed] = React.useState(false)
  const [manualMode, setManualMode] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [lookbackDays, setLookbackDays] = React.useState(30)
  const drive = props.provider === 'google-drive'
  const slack = props.provider === 'slack'

  const loadScopes = React.useCallback(
    async (provider: SyncProvider, selectedContainerId?: string) => {
      setDiscovering(true)
      setDiscoveryFailed(false)
      try {
        const result = await props.onDiscover(provider, selectedContainerId)
        setDiscovery(result)
        if (provider === 'slack')
          setSelectedScopeIds((current) =>
            current.length > 0
              ? current.slice(0, 1)
              : result.scopes.slice(0, 1).map(({ id }) => id),
          )
        if (result.resolvedContainerId !== undefined)
          setContainerId(result.resolvedContainerId)
      } catch {
        setDiscoveryFailed(true)
      } finally {
        setDiscovering(false)
      }
    },
    [props.onDiscover],
  )

  React.useEffect(() => {
    if (!props.open || props.provider === null) return
    const initialContainerId = props.initialContainerId ?? ''
    const initialScopes = [
      ...(props.provider === 'slack'
        ? (props.initialChannelIds ?? []).slice(0, 1)
        : []),
      ...(props.provider === 'google-drive'
        ? (props.initialRootFolderIds ?? [])
        : []),
    ]
    setContainerId(initialContainerId)
    setSelectedScopeIds([...initialScopes])
    setManualScopes(initialScopes.join(', '))
    setDiscovery(undefined)
    setManualMode(false)
    setLookbackDays(30)
    void loadScopes(
      props.provider,
      props.provider === 'google-drive' && initialContainerId.length > 0
        ? initialContainerId
        : undefined,
    )
  }, [
    loadScopes,
    props.initialChannelIds,
    props.initialContainerId,
    props.initialRootFolderIds,
    props.open,
    props.provider,
  ])

  const manualIds = manualScopes
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const scopeIds = manualMode ? manualIds : selectedScopeIds
  const valid =
    props.provider !== null &&
    (slack
      ? scopeIds.length === 1
      : containerId.trim().length > 0 && (!drive || scopeIds.length > 0))

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={({ open }) => {
        if (!open && !pending) props.onClose()
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            {slack
              ? 'Choose a Slack channel'
              : drive
                ? 'Choose Google Drive scope'
                : 'Confirm HubSpot portal'}
          </Dialog.Title>
          <Dialog.CloseButton />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap="4">
            <Text color="fg.muted" textStyle="sm">
              {slack
                ? 'Start narrow: choose one channel for the first Company Brain sync. You can change the approved channel before a later sync.'
                : drive
                  ? 'Choose one Shared Drive, then explicitly approve its full root or specific folders.'
                  : 'The portal below was detected from the account you authorized.'}
            </Text>

            {discovering ? (
              <Box display="flex" alignItems="center" gap="2" py="4">
                <Spinner size="sm" />
                <Text textStyle="sm">Loading available provider scopes…</Text>
              </Box>
            ) : null}

            {!discovering && !manualMode && drive ? (
              <Field.Root required>
                <Field.Label>Shared Drive</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={containerId}
                    onChange={(event) => {
                      const value = event.target.value
                      setContainerId(value)
                      setSelectedScopeIds([])
                      if (value.length > 0)
                        void loadScopes('google-drive', value)
                    }}
                  >
                    <option value="">Choose a Shared Drive</option>
                    {discovery?.containers.map((container) => (
                      <option key={container.id} value={container.id}>
                        {container.label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
            ) : null}

            {!discovering && !manualMode && !drive && !slack ? (
              <Field.Root required>
                <Field.Label>HubSpot portal</Field.Label>
                <Input
                  value={
                    discovery?.containers.find(({ id }) => id === containerId)
                      ?.label ?? containerId
                  }
                  readOnly
                />
              </Field.Root>
            ) : null}

            {!discovering && !manualMode && (slack || drive) && discovery ? (
              <Field.Root required>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Field.Label>
                    {slack ? 'Approved channel' : 'Approved folders'}
                  </Field.Label>
                  <Box display="flex" gap="1">
                    {drive ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setSelectedScopeIds(
                            discovery.scopes.map((scope) => scope.id),
                          )
                        }
                      >
                        Select all
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setSelectedScopeIds([])}
                    >
                      Clear
                    </Button>
                  </Box>
                </Box>
                <VStack
                  align="stretch"
                  maxH="72"
                  overflowY="auto"
                  borderWidth="1px"
                  borderRadius="md"
                  p="3"
                >
                  {discovery.scopes.length === 0 ? (
                    <Text color="fg.muted" textStyle="sm">
                      {drive && containerId.length === 0
                        ? 'Choose a Shared Drive first.'
                        : 'No available scopes were returned.'}
                    </Text>
                  ) : (
                    discovery.scopes.map((scope) => (
                      <Checkbox
                        key={scope.id}
                        checked={selectedScopeIds.includes(scope.id)}
                        onCheckedChange={({ checked }) =>
                          setSelectedScopeIds((current) =>
                            slack
                              ? selectSlackChannel(scope.id, checked === true)
                              : toggleScopeSelection(
                                  current,
                                  scope.id,
                                  checked === true,
                                ),
                          )
                        }
                      >
                        {scope.label}
                        {scope.description ? ` · ${scope.description}` : ''}
                      </Checkbox>
                    ))
                  )}
                </VStack>
                <Field.HelperText>
                  {slack
                    ? selectedScopeIds.length === 1
                      ? '1 channel selected'
                      : 'Choose one channel'
                    : `${selectedScopeIds.length} selected`}
                </Field.HelperText>
              </Field.Root>
            ) : null}

            {slack ? (
              <Field.Root>
                <Field.Label>Message history</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={String(lookbackDays)}
                    onChange={(event) =>
                      setLookbackDays(Number(event.target.value))
                    }
                  >
                    <option value="14">Last 14 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="60">Last 60 days</option>
                    <option value="90">Last 90 days</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                <Field.HelperText>
                  One channel · up to 1,000 messages total. Progress appears on
                  the connection card while the sync runs.
                </Field.HelperText>
              </Field.Root>
            ) : null}

            {manualMode ? (
              <VStack align="stretch" gap="3">
                {!slack ? (
                  <Field.Root required>
                    <Field.Label>
                      {drive ? 'Shared Drive ID' : 'HubSpot portal ID'}
                    </Field.Label>
                    <Input
                      value={containerId}
                      onChange={(event) => setContainerId(event.target.value)}
                    />
                  </Field.Root>
                ) : null}
                {drive || slack ? (
                  <Field.Root required>
                    <Field.Label>
                      {slack ? 'Slack channel ID' : 'Root folder IDs'}
                    </Field.Label>
                    <Input
                      value={manualScopes}
                      onChange={(event) => setManualScopes(event.target.value)}
                      placeholder={
                        slack ? 'Enter one channel ID' : 'Separate IDs with commas'
                      }
                    />
                  </Field.Root>
                ) : null}
              </VStack>
            ) : null}

            {discoveryFailed && !manualMode ? (
              <Text color="fg.error" textStyle="sm">
                Automatic scope discovery failed. You can retry or enter the
                provider IDs manually.
              </Text>
            ) : null}

            {discoveryFailed || manualMode ? (
              <Button
                variant="ghost"
                size="sm"
                alignSelf="start"
                onClick={() => {
                  if (manualMode && props.provider !== null) {
                    setManualMode(false)
                    void loadScopes(
                      props.provider,
                      drive && containerId.length > 0 ? containerId : undefined,
                    )
                    return
                  }
                  setManualMode(true)
                }}
              >
                {manualMode ? 'Try automatic discovery' : 'Enter IDs manually'}
              </Button>
            ) : null}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" disabled={pending} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || pending || discovering}
            loading={pending}
            onClick={async () => {
              if (!valid || props.provider === null) return
              setPending(true)
              try {
                await props.onSync({
                  provider: props.provider,
                  containerId: containerId.trim(),
                  rootFolderIds: drive ? scopeIds : [],
                  channelIds: slack ? scopeIds : [],
                  lookbackDays,
                })
                props.onClose()
              } finally {
                setPending(false)
              }
            }}
          >
            Sync approved scope
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
