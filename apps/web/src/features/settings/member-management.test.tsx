import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { createMemberManagementAdapter } from "./member-management-adapter";
import type {
  InvitationId,
  MembershipId,
  WorkspaceId,
} from "./member-management-adapter";
import { MemberManagement } from "./member-management";

const workspaceId = "workspaces_1" as WorkspaceId;
const membershipId = "workspaceMembers_1" as MembershipId;
const invitationId = "invitations_1" as InvitationId;

const mutations = () => ({
  createInvitation: vi.fn().mockResolvedValue(invitationId),
  cancelInvitation: vi.fn().mockResolvedValue(null),
  changeRole: vi.fn().mockResolvedValue(null),
  removeMember: vi.fn().mockResolvedValue(null),
  transferOwnership: vi.fn().mockResolvedValue(null),
});

const render = (role: "viewer" | "editor" | "admin" | "owner") => {
  const adapter = createMemberManagementAdapter({
    role,
    workspaceId,
    mutations: mutations(),
  });

  return renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <MemberManagement
        adapter={adapter}
        members={{
          status: "ready",
          data: [
            {
              membershipId,
              email: "ada@example.com",
              role: "editor",
              isCurrentActor: false,
            },
          ],
        }}
        invitations={{
          status: "ready",
          data: [
            {
              invitationId,
              email: "pending@example.com",
              role: "viewer",
            },
          ],
        }}
      />
    </MaestroSaasUiProvider>,
  );
};

describe("MemberManagement", () => {
  it("renders read-only rows for viewers and editors without mutation controls", () => {
    const html = render("viewer");

    expect(html).toContain("Member management is read-only for this role.");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("pending@example.com");
    expect(html).not.toContain("Invite member");
    expect(html).not.toContain("Remove member");
    expect(html).not.toContain("Cancel invitation");
  });

  it("renders invite, role, remove, cancel, and transfer controls for owners", () => {
    const html = render("owner");

    expect(html).toContain("Invite member");
    expect(html).toContain("Change role");
    expect(html).toContain("Remove member");
    expect(html).toContain("Cancel invitation");
    expect(html).toContain("Transfer ownership");
  });

  it("hides admin controls for owner rows and owner invitations", () => {
    const adapter = createMemberManagementAdapter({
      role: "admin",
      workspaceId,
      mutations: mutations(),
    });
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <MemberManagement
          adapter={adapter}
          members={{
            status: "ready",
            data: [
              {
                membershipId,
                email: "owner@example.com",
                role: "owner",
                isCurrentActor: false,
              },
            ],
          }}
          invitations={{
            status: "ready",
            data: [
              {
                invitationId,
                email: "pending-owner@example.com",
                role: "owner",
              },
            ],
          }}
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("owner@example.com");
    expect(html).toContain("pending-owner@example.com");
    expect(html).not.toContain("Change role");
    expect(html).not.toContain("Remove member");
    expect(html).not.toContain("Cancel invitation");
    expect(html).not.toContain("Transfer ownership");
  });

  it("hides self-transfer using the server-derived current actor marker", () => {
    const adapter = createMemberManagementAdapter({
      role: "owner",
      workspaceId,
      mutations: mutations(),
    });
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <MemberManagement
          adapter={adapter}
          members={{
            status: "ready",
            data: [
              {
                membershipId: "workspaceMembers_owner" as MembershipId,
                email: "owner@example.com",
                role: "owner",
                isCurrentActor: true,
              },
              {
                membershipId: "workspaceMembers_admin" as MembershipId,
                email: "admin@example.com",
                role: "admin",
                isCurrentActor: false,
              },
            ],
          }}
          invitations={{ status: "ready", data: [] }}
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).not.toContain("Transfer ownership to owner@example.com");
    expect(html).toContain("Transfer ownership to admin@example.com");
  });

  it("renders loading and typed denial states instead of false emptiness", () => {
    const adapter = createMemberManagementAdapter({
      role: "admin",
      workspaceId,
      mutations: mutations(),
    });
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <MemberManagement
          adapter={adapter}
          members={{ status: "loading" }}
          invitations={{
            status: "denied",
            message: "Invitation list access denied.",
          }}
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("Loading member rows");
    expect(html).toContain("Invitation list access denied.");
    expect(html).not.toContain("No members found.");
  });
});
