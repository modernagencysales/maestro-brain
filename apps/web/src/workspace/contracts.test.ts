import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ContactDTO,
  WorkspaceDTO,
  WorkspaceMemberSettingsDTO,
} from "./api/types";
import { api } from "../lib/trpc/react";

describe("canonical UI compatibility contracts", () => {
  it("keeps neutral query collections structurally usable", () => {
    expect(api.contacts.listByType.useQuery().data.contacts).toEqual([]);
    expect(api.notifications.inbox.useQuery().data.notifications).toEqual([]);
    expect(api.workspaceMembers.list.useQuery().data).toEqual([]);
  });

  it("exposes the DTO fields consumed by canonical feature adapters", () => {
    expectTypeOf<ContactDTO>().toHaveProperty("workspaceId");
    expectTypeOf<WorkspaceDTO>().toHaveProperty("subscription");
    expectTypeOf<WorkspaceDTO>().toHaveProperty("members");
    expectTypeOf<WorkspaceMemberSettingsDTO>().toHaveProperty("topics");
  });
});
