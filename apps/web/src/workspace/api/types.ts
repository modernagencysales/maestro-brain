export type ContactDTO = {
  id: string;
  workspaceId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  avatar?: string | null;
  status: "new" | "active" | "inactive";
  type: "lead" | "customer";
  tags?: string[] | null;
  sortOrder?: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type NotificationMetadata = {
  action?: string;
  comment?: string;
  field?: string;
  status?: string;
  tags?: string[];
  type?: string;
  value?: string;
};

export type NotificationDTO = {
  id: string;
  workspaceId: string;
  type: string | null;
  targetId: string;
  actorId: string | null;
  subjectId: string;
  metadata: NotificationMetadata | null;
  readAt: Date | string | null;
  createdAt: Date | string;
  subject?: ContactDTO;
};

export type TagDTO = {
  id: string;
  name: string;
  color?: string | null;
};

export type UserDTO = {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type WorkspaceMemberDTO = UserDTO & {
  roles: string[];
  status: "active" | "suspended" | "invited";
  presence?: "online" | "offline" | "away" | "dnd";
};

export type BillingSubscriptionDTO = {
  accountId?: string | null;
  status?:
    | "active"
    | "canceled"
    | "past_due"
    | "trialing"
    | "unpaid"
    | "incomplete"
    | "incomplete_expired"
    | "paused";
  planId?: string;
  startedAt?: Date;
  trialEndsAt?: Date | null;
  cancelAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date;
};

export type WorkspaceDTO = {
  id: string;
  ownerId?: string | null;
  slug: string;
  name: string;
  logo?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  subscription: BillingSubscriptionDTO;
  members: WorkspaceMemberDTO[];
};

export type WorkspaceMemberSettingsDTO = {
  userId?: string;
  workspaceId?: string;
  channels?: {
    email?: boolean;
    desktop?: boolean;
  };
  newsletters?: {
    product_updates?: boolean;
    important_updates?: boolean;
  };
  topics?: {
    contacts_new_lead?: boolean;
    contacts_account_upgraded?: boolean;
    inbox_assigned_to_me?: boolean;
    inbox_mentioned?: boolean;
  };
};
