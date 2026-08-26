'use client'

import * as React from 'react'
import { Field, Input, Text, VStack } from '@chakra-ui/react'
import { Button, Dialog } from '@saas-ui/react'

type Provider = 'slack' | 'google-drive' | 'hubspot'

export function ProviderSyncDialog(props: {
  open: boolean
  provider: Provider | null
  initialContainerId?: string
  initialRootFolderIds?: readonly string[]
  initialChannelIds?: readonly string[]
  onClose: () => void
  onSync: (input: {
    provider: Provider
    containerId: string
    rootFolderIds: readonly string[]
    channelIds: readonly string[]
  }) => Promise<void>
}) {
  const [containerId, setContainerId] = React.useState('')
  const [roots, setRoots] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const drive = props.provider === 'google-drive'
  const slack = props.provider === 'slack'
  const initialContainerId = props.initialContainerId ?? ''
  const initialRoots = (
    slack ? props.initialChannelIds : props.initialRootFolderIds
  )?.join(', ') ?? ''

  React.useEffect(() => {
    setContainerId(props.open ? initialContainerId : '')
    setRoots(props.open ? initialRoots : '')
  }, [initialContainerId, initialRoots, props.open])

  const rootFolderIds = roots
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const channelIds = slack ? rootFolderIds : []
  const valid =
    props.provider !== null &&
    (slack
      ? channelIds.length > 0
      : containerId.trim().length > 0 &&
        (!drive || rootFolderIds.length > 0))

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
              ? 'Choose Slack channels'
              : drive
                ? 'Choose Google Drive scope'
                : 'Choose HubSpot portal'}
          </Dialog.Title>
          <Dialog.CloseButton />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap="4">
            <Text color="fg.muted" textStyle="sm">
              {slack
                ? 'Only these approved Slack channels enter the Company Brain. Scheduled reconciliation reuses this exact allowlist.'
                : drive
                ? 'Only files under these approved Shared Drive folders enter the Company Brain.'
                : 'Companies, contacts, and deals from this portal enter the shared Company Brain.'}
            </Text>
            {!slack ? (
              <Field.Root required>
                <Field.Label>
                  {drive ? 'Shared Drive ID' : 'HubSpot portal ID'}
                </Field.Label>
                <Input
                  value={containerId}
                  onChange={(event) => setContainerId(event.target.value)}
                  placeholder={drive ? '0AExampleSharedDrive' : '12345678'}
                  autoFocus
                />
              </Field.Root>
            ) : null}
            {drive || slack ? (
              <Field.Root required>
                <Field.Label>
                  {slack ? 'Slack channel IDs' : 'Root folder IDs'}
                </Field.Label>
                <Input
                  value={roots}
                  onChange={(event) => setRoots(event.target.value)}
                  placeholder={
                    slack ? 'C01234567, C07654321' : 'folder-id-1, folder-id-2'
                  }
                  autoFocus={slack}
                />
                <Field.HelperText>
                  Separate multiple {slack ? 'channel' : 'folder'} IDs with
                  commas.
                </Field.HelperText>
              </Field.Root>
            ) : null}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" disabled={pending} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || pending}
            loading={pending}
            onClick={async () => {
              if (!valid || props.provider === null) return
              setPending(true)
              try {
                await props.onSync({
                  provider: props.provider,
                  containerId: containerId.trim(),
                  rootFolderIds,
                  channelIds,
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
