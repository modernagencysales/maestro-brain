import { describe, expect, it } from 'vitest'

import { invitationShareText } from './workspace-invitation-links'

describe('workspace invitation links', () => {
  it('builds shareable links on the current app origin', () => {
    expect(
      invitationShareText('https://brain.example', [
        { email: 'ada@example.com', invitationId: 'invitation_123' },
      ]),
    ).toBe(
      'ada@example.com: https://brain.example/accept-invite/invitation_123',
    )
  })
})
