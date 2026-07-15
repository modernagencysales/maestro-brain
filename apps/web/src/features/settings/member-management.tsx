import { Button, Card, Heading, Stack, Text } from "@saas-ui/react";

import type { WorkspaceRole } from "../../providers/workspace";
import type {
  InvitationId,
  MemberManagementAdapter,
  MembershipId,
} from "./member-management-adapter";

export type MemberManagementMember = {
  readonly membershipId: MembershipId;
  readonly email: string;
  readonly role: WorkspaceRole;
};

export type MemberManagementInvitation = {
  readonly invitationId: InvitationId;
  readonly email: string;
  readonly role: WorkspaceRole;
};

type RowState<T> =
  | { readonly status: "loading" }
  | { readonly status: "denied"; readonly message: string }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: readonly T[] };

export const MemberManagement = ({
  adapter,
  members = { status: "ready", data: [] },
  invitations = { status: "ready", data: [] },
}: {
  readonly adapter: MemberManagementAdapter;
  readonly members?: RowState<MemberManagementMember>;
  readonly invitations?: RowState<MemberManagementInvitation>;
}) => (
  <Card.Root>
    <Card.Header>
      <Heading size="md">Members</Heading>
    </Card.Header>
    <Card.Body>
      <Stack gap="4">
        {adapter.canManageMembers ? (
          <form
            aria-label="Invite member"
            action={async (formData) => {
              await adapter.inviteMember({
                email: String(formData.get("email") ?? ""),
                role: String(formData.get("role") ?? "viewer") as WorkspaceRole,
              });
            }}
          >
            <Stack gap="2">
              <Text>
                Admins and owners can invite members, change non-owner roles,
                and remove members through server-verified access actions.
              </Text>
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Role
                <select name="role" defaultValue="viewer">
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                  {adapter.role === "owner" ? (
                    <option value="owner">Owner</option>
                  ) : null}
                </select>
              </label>
              <Button type="submit">Invite member</Button>
            </Stack>
          </form>
        ) : (
          <Text>Member management is read-only for this role.</Text>
        )}

        <MemberRows adapter={adapter} members={members} />
        <InvitationRows adapter={adapter} invitations={invitations} />
      </Stack>
    </Card.Body>
  </Card.Root>
);

const MemberRows = ({
  adapter,
  members,
}: {
  readonly adapter: MemberManagementAdapter;
  readonly members: RowState<MemberManagementMember>;
}) => (
  <Stack gap="2">
    <Heading size="sm">Current members</Heading>
    {members.status === "loading" ? <Text>Loading member rows…</Text> : null}
    {members.status === "denied" ? <Text>{members.message}</Text> : null}
    {members.status === "error" ? <Text>{members.message}</Text> : null}
    {members.status === "ready" && members.data.length === 0 ? (
      <Text>No members found.</Text>
    ) : null}
    {members.status === "ready"
      ? members.data.map((member) => (
          <div key={member.membershipId} data-member-row={member.membershipId}>
            <Text>
              {member.email} — {member.role}
            </Text>
            {adapter.canManageMembers ? (
              <form
                aria-label={`Change role for ${member.email}`}
                action={async (formData) => {
                  await adapter.changeRole({
                    membershipId: member.membershipId,
                    role: String(
                      formData.get("role") ?? member.role,
                    ) as WorkspaceRole,
                  });
                }}
              >
                <select name="role" defaultValue={member.role}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                  {adapter.role === "owner" ? (
                    <option value="owner">Owner</option>
                  ) : null}
                </select>
                <Button type="submit">Change role</Button>
              </form>
            ) : null}
            {adapter.canManageMembers ? (
              <form
                aria-label={`Remove ${member.email}`}
                action={async () => {
                  await adapter.removeMember({
                    membershipId: member.membershipId,
                  });
                }}
              >
                <Button type="submit">Remove member</Button>
              </form>
            ) : null}
            {adapter.canTransferOwnership ? (
              <form
                aria-label={`Transfer ownership to ${member.email}`}
                action={async () => {
                  await adapter.transferOwnership({
                    membershipId: member.membershipId,
                  });
                }}
              >
                <Button type="submit">Transfer ownership</Button>
              </form>
            ) : null}
          </div>
        ))
      : null}
  </Stack>
);

const InvitationRows = ({
  adapter,
  invitations,
}: {
  readonly adapter: MemberManagementAdapter;
  readonly invitations: RowState<MemberManagementInvitation>;
}) => (
  <Stack gap="2">
    <Heading size="sm">Pending invitations</Heading>
    {invitations.status === "loading" ? (
      <Text>Loading pending invitations…</Text>
    ) : null}
    {invitations.status === "denied" ? (
      <Text>{invitations.message}</Text>
    ) : null}
    {invitations.status === "error" ? <Text>{invitations.message}</Text> : null}
    {invitations.status === "ready" && invitations.data.length === 0 ? (
      <Text>No pending invitations.</Text>
    ) : null}
    {invitations.status === "ready"
      ? invitations.data.map((invitation) => (
          <div
            key={invitation.invitationId}
            data-invitation-row={invitation.invitationId}
          >
            <Text>
              {invitation.email} — {invitation.role}
            </Text>
            {adapter.canManageMembers ? (
              <form
                aria-label={`Cancel invitation for ${invitation.email}`}
                action={async () => {
                  await adapter.cancelInvitation({
                    invitationId: invitation.invitationId,
                  });
                }}
              >
                <Button type="submit">Cancel invitation</Button>
              </form>
            ) : null}
          </div>
        ))
      : null}
  </Stack>
);
