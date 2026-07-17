import type { ProviderAdapter } from "@maestro-template/template-core";
import type { WorkspaceSummary } from "../../providers/workspace";

export type SettingsDocumentSection = {
  readonly heading: string;
  readonly body: readonly string[];
};

export type SettingsViewer = {
  readonly role: "viewer" | "editor" | "admin" | "owner";
};

export const buildSettingsDocumentSections = ({
  workspace,
  viewer,
  providers,
}: {
  readonly workspace: WorkspaceSummary | null;
  readonly viewer: SettingsViewer;
  readonly providers: readonly ProviderAdapter[];
}): readonly SettingsDocumentSection[] => {
  if (!workspace) {
    return [
      {
        heading: "Workspace setup required",
        body: [
          "Settings stay read-only until the app has a server-derived active workspace.",
          "Run provisioning before enabling member, provider, billing, or deploy controls.",
        ],
      },
    ];
  }

  const canAdminister = viewer.role === "admin" || viewer.role === "owner";
  const canTransferOwnership = viewer.role === "owner";

  return [
    {
      heading: "Workspace",
      body: [
        `${workspace.name} is the active workspace.`,
        canAdminister
          ? "Admin controls are available for workspace setup and provider posture."
          : "This viewer can inspect setup posture but cannot change workspace settings.",
      ],
    },
    {
      heading: "Members",
      body: [
        canAdminister
          ? "Member invites, role changes, and removals use generated access refs and server RBAC."
          : "Member management is hidden for non-admin roles.",
        canTransferOwnership
          ? "Owners may transfer Brain ownership without leaving zero owners."
          : "Ownership transfer remains owner-only.",
      ],
    },
    {
      heading: "Brain API keys",
      body: [
        canAdminister
          ? "Admins can create, rotate, and revoke display-once one-Brain keys through generated API-key refs."
          : "API key creation, rotation, and revocation are hidden for non-admin roles.",
        "Server-side authorization remains the enforcement boundary for every API-key action.",
      ],
    },
    {
      heading: "Provider health",
      body: providers.map(
        (provider) =>
          `${provider.name}: ${provider.status} through ${provider.mode} mode.`,
      ),
    },
    {
      heading: "Billing and credits",
      body: [
        providerLine(providers, "Dodo"),
        "Fake billing proves credit and entitlement flows without live payment secrets.",
      ],
    },
    {
      heading: "Safe environment rendering",
      body: [
        "The frontend may display provider posture and missing secret names.",
        "The frontend must never render secret values or construct live provider SDK clients.",
      ],
    },
  ];
};

function providerLine(
  providers: readonly ProviderAdapter[],
  name: string,
): string {
  const provider = providers.find((candidate) => candidate.name === name);

  return provider
    ? `${provider.name}: ${provider.status} through ${provider.mode} mode.`
    : `${name}: not configured.`;
}
