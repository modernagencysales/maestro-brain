import type { WorkspaceSummary } from "../../providers/workspace";
import type {
  SettingsDocumentSection,
  SettingsViewer,
} from "./settings-surface";

export type PublicApiKeySettingsMetadata = {
  readonly name: string;
  readonly displayPrefix: string;
  readonly scopes: readonly ("brain:read" | "brain:ask" | "brain:write")[];
  readonly roleCeiling: "viewer";
  readonly status: "active" | "revoked" | "expired";
  readonly createdAt: number;
  readonly expiresAt: number | null;
};

export type ApiKeySettingsMetadata = PublicApiKeySettingsMetadata & {
  readonly id: string;
};

export const buildApiKeySettingsSections = ({
  workspace,
  viewer,
  keys,
  brainKey,
}: {
  readonly workspace: WorkspaceSummary | null;
  readonly viewer: SettingsViewer;
  readonly keys: readonly ApiKeySettingsMetadata[];
  readonly brainKey: string | null;
}): readonly SettingsDocumentSection[] => {
  if (!workspace || brainKey === null) {
    return [
      {
        heading: "API keys unavailable",
        body: [
          "API keys require a server-derived active workspace and Brain scope.",
        ],
      },
    ];
  }

  const canAdminister = viewer.role === "admin" || viewer.role === "owner";
  const overview: SettingsDocumentSection = {
    heading: "Brain API keys",
    body: [
      canAdminister
        ? "Admins can create expiring, viewer-ceiling keys for one Brain."
        : "API key creation, rotation, and revocation are hidden for non-admin roles.",
      "Secrets are displayed once at creation; settings only renders prefixes and metadata.",
    ],
  };

  return [overview, ...keys.map((key) => renderKeySection(key, brainKey))];
};

const renderKeySection = (
  key: ApiKeySettingsMetadata,
  brainKey: string,
): SettingsDocumentSection => ({
  heading: key.name,
  body: [
    `Brain: ${brainKey}`,
    `Scopes: ${key.scopes.join(", ")}`,
    `Role ceiling: ${key.roleCeiling}`,
    `Status: ${key.status}`,
    `Prefix: ${key.displayPrefix}`,
    key.expiresAt === null ? "Expires: missing" : `Expires: ${key.expiresAt}`,
  ],
});
