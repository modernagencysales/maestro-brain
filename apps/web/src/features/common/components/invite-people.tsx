import { toast } from "@saas-ui/react";

import { InviteDialog } from "@workspace/ui/invite-dialog";

import { api, isTRPCClientError } from "#lib/trpc/react";

import { useCurrentWorkspace } from "../hooks/use-current-workspace";

type InviteInput = Parameters<
  React.ComponentProps<typeof InviteDialog>["onInvite"] &
    ((...args: never) => never)
>[0];

export function InvitePeopleDialog(props: {
  open?: boolean;
  onOpenChange?: (details: { open: boolean }) => void;
}) {
  const [workspace] = useCurrentWorkspace();

  const inviteMembers = api.workspaceMembers.invite.useMutation();

  const onInvite = (input: InviteInput) =>
    invitePeople(input, workspace.id, inviteMembers.mutateAsync);

  return <InviteDialog {...props} onInvite={onInvite} />;
}

const invitePeople = async (
  { emails, role }: InviteInput,
  workspaceId: string,
  mutate: ReturnType<
    typeof api.workspaceMembers.invite.useMutation
  >["mutateAsync"],
) => {
  const result = await toast.promise(mutate({ workspaceId, emails, role }), {
    loading: { title: inviteLoadingTitle(emails) },
    success: () => ({ title: "Invitation(s) have been sent." }),
    error: inviteError,
  });
  if (!result) throw new Error("Failed to invite people");
};

const inviteLoadingTitle = (emails: string[]) =>
  emails.length === 1
    ? `Inviting ${emails[0]}...`
    : `Inviting ${emails.length} people...`;

const inviteError = (error: unknown) => {
  if (isTRPCClientError(error)) console.error(error.data);
  return {
    title: error instanceof Error ? error.message : "Invite failed",
  };
};
