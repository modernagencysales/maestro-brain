export const buildInvitationUrl = (
  publicBaseUrl: string,
  invitationId: string,
): string =>
  new URL(
    `/accept-invite/${encodeURIComponent(invitationId)}`,
    new URL(publicBaseUrl).origin,
  ).toString();
