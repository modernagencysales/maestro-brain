'use client'

import * as React from 'react'
import { Field, Input, Text, VStack } from '@chakra-ui/react'
import { Button, Dialog } from '@saas-ui/react'

type Provider = 'google-drive' | 'hubspot'

export function ProviderSyncDialog(props: {
  open: boolean
  provider: Provider | null
  onClose: () => void
  onSync: (input: {
    provider: Provider
    containerId: string
    rootFolderIds: readonly string[]
  }) => Promise<void>
}) {
  const [containerId, setContainerId] = React.useState('')
  const [roots, setRoots] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const drive = props.provider === 'google-drive'

  React.useEffect(() => {
    if (!props.open) {
      setContainerId('')
      setRoots('')
    }
  }, [props.open, props.provider])

  const rootFolderIds = roots
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const valid =
    props.provider !== null &&
    containerId.trim().length > 0 &&
    (!drive || rootFolderIds.length > 0)

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
            {drive ? 'Choose Google Drive scope' : 'Choose HubSpot portal'}
          </Dialog.Title>
          <Dialog.CloseButton />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap="4">
            <Text color="fg.muted" textStyle="sm">
              {drive
                ? 'Only files under these approved Shared Drive folders enter the Company Brain.'
                : 'Companies, contacts, and deals from this portal enter the shared Company Brain.'}
            </Text>
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
            {drive ? (
              <Field.Root required>
                <Field.Label>Root folder IDs</Field.Label>
                <Input
                  value={roots}
                  onChange={(event) => setRoots(event.target.value)}
                  placeholder="folder-id-1, folder-id-2"
                />
                <Field.HelperText>Separate multiple folder IDs with commas.</Field.HelperText>
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
