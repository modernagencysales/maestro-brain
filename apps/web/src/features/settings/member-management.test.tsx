import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { createMemberManagementAdapter } from "./member-management-adapter";
import { MemberManagement } from "./member-management";

const refs = {
  members: {
    changeRole: {
      functionNamespace: "access/members",
      functionSpec: { name: "changeRole" },
    },
    remove: {
      functionNamespace: "access/members",
      functionSpec: { name: "remove" },
    },
    transferOwnership: {
      functionNamespace: "access/members",
      functionSpec: { name: "transferOwnership" },
    },
  },
  invitations: {
    create: {
      functionNamespace: "access/invitations",
      functionSpec: { name: "create" },
    },
    cancel: {
      functionNamespace: "access/invitations",
      functionSpec: { name: "cancel" },
    },
  },
} as const;

const render = (role: "viewer" | "editor" | "admin" | "owner") => {
  const adapter = createMemberManagementAdapter({
    role,
    workspaceId: "workspaces_1",
    refs,
    runMutation: vi.fn(),
  });

  return renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <MemberManagement adapter={adapter} />
    </MaestroSaasUiProvider>,
  );
};

describe("MemberManagement", () => {
  it("renders read-only copy for viewers and editors", () => {
    const html = render("viewer");

    expect(html).toContain("Member management is read-only for this role.");
    expect(html).not.toContain("Invite member");
  });

  it("renders privileged controls for admins and owner-only transfer copy for owners", () => {
    const html = render("owner");

    expect(html).toContain("Invite member");
    expect(html).toContain("Ownership transfer is available to owners only.");
  });
});
