import accessAuditEvents from "../tables/accessAuditEvents";
import invitations from "../tables/invitations";
import organizationMembers from "../tables/organizationMembers";
import organizations from "../tables/organizations";
import users from "../tables/users";
import workspaceMembers from "../tables/workspaceMembers";

export default {
  users,
  organizations,
  organizationMembers,
  workspaceMembers,
  invitations,
  accessAuditEvents,
} as const;
