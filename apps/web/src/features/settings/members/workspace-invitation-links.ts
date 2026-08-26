import type { WorkspaceInvitationResult } from '#lib/trpc/react'

export const invitationShareText = (
  origin: string,
  invitations: readonly WorkspaceInvitationResult[],
): string =>
  invitations
    .map(
      ({ email, invitationId }) =>
        `${email}: ${new URL(`/accept-invite/${invitationId}`, origin).toString()}`,
    )
    .join('\n')
