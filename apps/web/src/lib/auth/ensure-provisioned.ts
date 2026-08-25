import {
  getFunctionReference,
  templateConfectRefs,
} from "@maestro-template/convex/refs";

type ProvisioningClient = {
  readonly mutation: (reference: never, args: never) => Promise<unknown>;
};

export const sessionEmailArgs = (user: unknown) => {
  if (typeof user !== "object" || user === null || !("email" in user)) {
    return {};
  }
  const email = user.email;
  return typeof email === "string" && email.trim().length > 0
    ? { sessionEmail: email }
    : {};
};

export const ensureAuthenticatedUserProvisioned = async (
  client: ProvisioningClient,
  user: unknown,
) =>
  client.mutation(
    getFunctionReference(
      templateConfectRefs.public.access.provisioning.ensureProvisioned,
    ) as never,
    sessionEmailArgs(user) as never,
  );

export const hasLegacyUppercaseWorkspaceSlug = (pathname: string): boolean => {
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  if (!firstSegment || firstSegment === firstSegment.toLowerCase()) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(firstSegment.toLowerCase());
};
