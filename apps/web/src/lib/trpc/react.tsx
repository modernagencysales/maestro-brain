import type { BillingPlan } from "@saas-ui-pro/billing";

import type {
  ContactDTO,
  NotificationDTO,
  UserDTO,
  WorkspaceDTO,
  WorkspaceMemberDTO,
  WorkspaceMemberSettingsDTO,
} from "@workspace/api/types";

export type QueryResult<TData> = {
  data: TData;
  isLoading: boolean;
  isPending: boolean;
  error?: Error;
};

type MutationOptions<TData> = {
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
  onSettled?: (data: TData | undefined, error: Error | null) => void;
};

export type MutationResult<TInput, TData> = {
  data?: TData;
  variables?: TInput;
  mutate: (input: TInput) => void;
  mutateAsync: (input: TInput) => Promise<TData>;
  isPending: boolean;
  reset: () => void;
};

export type StarterProcedure<
  TData,
  TMutationData = TData,
  TInput = Record<string, unknown>,
> = {
  useQuery: (input?: TInput) => QueryResult<TData>;
  useSuspenseQuery: (input?: TInput) => readonly [TData, QueryResult<TData>];
  ensureData: (input?: TInput) => Promise<TData>;
  getData: (input?: TInput) => TData;
  useMutation: (
    options?: MutationOptions<TMutationData>,
  ) => MutationResult<TInput, TMutationData>;
  invalidate: (input?: TInput) => Promise<void>;
};

const procedure = <
  TData,
  TMutationData = TData,
  TInput = Record<string, unknown>,
>(
  data: TData,
): StarterProcedure<TData, TMutationData, TInput> => ({
  useQuery: () => ({ data, isLoading: false, isPending: false }),
  useSuspenseQuery: () => [data, { data, isLoading: false, isPending: false }],
  ensureData: async () => data,
  getData: () => data,
  useMutation: () => ({
    data: undefined,
    variables: undefined,
    mutate: () => undefined,
    mutateAsync: async () => undefined as TMutationData,
    isPending: false,
    reset: () => undefined,
  }),
  invalidate: async () => undefined,
});

type ActivityDTO = {
  id: string;
  type: "action" | "comment" | "update";
  actorId?: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
};

type InvoiceDTO = {
  number: string;
  date: Date | string | number;
  status: string;
  total: number;
  currency: string;
  url?: string | null;
};

type AccountDTO = {
  providerId: string;
  updatedAt: Date | null;
};

const auth = {
  me: procedure<UserDTO | null>(null),
  listAccounts: procedure<AccountDTO[]>([]),
};

const workspaces = {
  bySlug: procedure<WorkspaceDTO | null>(null),
  create: procedure<null, { slug: string }>(null),
  slugAvailable: procedure<null, { available: boolean }>(null),
  update: procedure<null>(null),
  invalidate: async () => undefined,
};

const workspaceMembers = {
  list: procedure<WorkspaceMemberDTO[]>([]),
  invite: procedure<null>(null),
  removeMember: procedure<null>(null),
  updateRoles: procedure<null>(null),
  notificationSettings: procedure<WorkspaceMemberSettingsDTO>({}),
  updateNotificationSettings: procedure<null>(null),
  invitation: procedure<{
    invitedBy?: string | null;
    workspace: Pick<WorkspaceDTO, "name" | "slug">;
  } | null>(null),
  acceptInvitation: procedure<null>(null),
};

const contacts = {
  listByType: procedure<{ contacts: ContactDTO[] }>({ contacts: [] }),
  byId: procedure<ContactDTO | null>(null),
  activitiesById: procedure<{ activities: ActivityDTO[] }>({ activities: [] }),
  create: procedure<null, ContactDTO>(null),
  update: procedure<null>(null),
  updateTags: procedure<null>(null),
  addComment: procedure<null>(null),
  removeComment: procedure<null>(null),
};

const notifications = {
  inbox: procedure<{ notifications: NotificationDTO[] }>({ notifications: [] }),
};

const billing = {
  plans: procedure<BillingPlan[]>([]),
  account: procedure<{ email: string } | null>(null),
  listInvoices: procedure<InvoiceDTO[]>([]),
  updateBillingDetails: procedure<null>(null),
  createBillingPortalSession: procedure<null, { url: string }>(null),
  createCheckoutSession: procedure<null, { url: string }>(null),
  setSubscriptionPlan: procedure<null>(null),
};

const users = {
  subscribeToNewsletter: procedure<null>(null),
  updateProfile: procedure<null>(null),
};

const tags = {
  create: procedure<null>(null),
  update: procedure<null>(null),
  delete: procedure<null>(null),
};

export const api = {
  auth,
  workspaces,
  workspaceMembers,
  contacts,
  notifications,
  billing,
  users,
  tags,
  useUtils: () => api,
};

export const isTRPCClientError = (
  error: unknown,
): error is Error & { data?: unknown } => error instanceof Error;
