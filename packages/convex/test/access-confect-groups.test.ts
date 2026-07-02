import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";

describe("access Confect groups", () => {
  it("exposes workspace member lifecycle refs", () => {
    expect(refs.public.access.members.changeRole).toMatchObject({
      functionNamespace: "access/members",
      functionSpec: {
        name: "changeRole",
        functionVisibility: "public",
      },
    });
    expect(refs.public.access.members.remove).toMatchObject({
      functionNamespace: "access/members",
      functionSpec: {
        name: "remove",
        functionVisibility: "public",
      },
    });
    expect(refs.public.access.members.transferOwnership).toMatchObject({
      functionNamespace: "access/members",
      functionSpec: {
        name: "transferOwnership",
        functionVisibility: "public",
      },
    });
  });

  it("exposes workspace invitation lifecycle refs", () => {
    expect(refs.public.access.invitations.create).toMatchObject({
      functionNamespace: "access/invitations",
      functionSpec: {
        name: "create",
        functionVisibility: "public",
      },
    });
    expect(refs.public.access.invitations.accept).toMatchObject({
      functionNamespace: "access/invitations",
      functionSpec: {
        name: "accept",
        functionVisibility: "public",
      },
    });
    expect(refs.public.access.invitations.decline).toMatchObject({
      functionNamespace: "access/invitations",
      functionSpec: {
        name: "decline",
        functionVisibility: "public",
      },
    });
    expect(refs.public.access.invitations.cancel).toMatchObject({
      functionNamespace: "access/invitations",
      functionSpec: {
        name: "cancel",
        functionVisibility: "public",
      },
    });
  });
});
