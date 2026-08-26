export type MutationExecution = Readonly<{
  handled: boolean;
  value: unknown;
}>;

type WorkspaceMemberMutationKey =
  | "workspaceMembers.invite"
  | "workspaceMembers.acceptInvitation"
  | "workspaceMembers.removeMember"
  | "workspaceMembers.updateRoles";

type Mutate = (
  key: WorkspaceMemberMutationKey,
  input: Record<string, unknown>,
) => Promise<unknown>;

type MutationHandler = (
  input: Record<string, unknown>,
  mutate: Mutate,
) => Promise<unknown>;

const inputString = (
  input: Record<string, unknown>,
  key: string,
  fallback: string,
): string => (typeof input[key] === "string" ? input[key] : fallback);

const memberRole = (value: unknown): "admin" | "editor" | "viewer" => {
  if (value === "admin") return "admin";
  if (value === "viewer") return "viewer";
  return "editor";
};

export const executeWorkspaceMemberMutation = async (
  key: string,
  input: Record<string, unknown>,
  mutate: Mutate,
): Promise<MutationExecution> => {
  const handler = mutationHandlers[key];
  return handler === undefined
    ? { handled: false, value: undefined }
    : { handled: true, value: await handler(input, mutate) };
};

const invite: MutationHandler = async (input, mutate) => {
  const workspaceId = inputString(input, "workspaceId", "");
  const emails = Array.isArray(input.emails)
    ? input.emails.filter((email): email is string => typeof email === "string")
    : [];
  return Promise.all(
    emails.map(async (email) => ({
      email,
      invitationId: await mutate("workspaceMembers.invite", {
        workspaceId,
        email,
        role: memberRole(input.role),
      }),
    })),
  );
};

const acceptInvitation: MutationHandler = (input, mutate) =>
  mutate("workspaceMembers.acceptInvitation", {
    invitationId: inputString(input, "token", ""),
  });

const removeMember: MutationHandler = (input, mutate) =>
  mutate("workspaceMembers.removeMember", {
    membershipId: inputString(input, "id", ""),
  });

const updateRoles: MutationHandler = (input, mutate) => {
  const roles = Array.isArray(input.roles) ? input.roles : [];
  return mutate("workspaceMembers.updateRoles", {
    membershipId: inputString(input, "userId", ""),
    newRole: memberRole(roles[0]),
  });
};

const mutationHandlers: Readonly<Record<string, MutationHandler>> = {
  "workspaceMembers.invite": invite,
  "workspaceMembers.acceptInvitation": acceptInvitation,
  "workspaceMembers.removeMember": removeMember,
  "workspaceMembers.updateRoles": updateRoles,
};
