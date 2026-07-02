import { useState } from "react";
import {
  createMockAdapters,
  SettingsContent,
  SettingsPanel,
  SettingsProvider,
  SettingsRule,
  SettingsSection,
  SettingsSidebar,
  SettingsSidebarGroup,
  SettingsSidebarTitle,
  SettingsTab,
  type AccountStore,
  type SettingsAdapters,
  type TabType,
  type WorkspaceStore,
} from "@notion-kit/settings-panel";

export type TemplateSettingsTab = Extract<
  TabType,
  "general" | "people" | "billing" | "notifications" | "security"
>;

const templateSettingsTabs: readonly {
  readonly key: TemplateSettingsTab;
  readonly label: string;
  readonly icon: string;
}[] = [
  { key: "general", label: "Workspace", icon: "W" },
  { key: "people", label: "People", icon: "P" },
  { key: "billing", label: "Billing", icon: "$" },
  { key: "notifications", label: "Notifications", icon: "N" },
  { key: "security", label: "Security", icon: "S" },
];

export function createTemplateSettingsMockAdapters(options?: {
  readonly appName?: string;
  readonly workspaceSlug?: string;
}): SettingsAdapters {
  const workspaceName = options?.appName ?? "Maestro Template";
  const account: AccountStore = {
    id: "user_template_operator",
    name: "Template Operator",
    preferredName: "Template Operator",
    email: "operator@example.test",
    avatarUrl: "",
    hasPassword: true,
    currentSessionId: "session_template_local",
  };
  const workspace: WorkspaceStore = {
    id: "workspace_template",
    name: workspaceName,
    icon: { type: "text", src: workspaceName.slice(0, 1) },
    slug: options?.workspaceSlug ?? "maestro-template",
    inviteLink: "https://example.test/invite/template",
    plan: "business" as WorkspaceStore["plan"],
    role: "owner" as WorkspaceStore["role"],
  };

  return createMockAdapters({
    account,
    workspace,
    sessions: [
      {
        id: "session_template_local",
        token: "local",
        device: "Local browser",
        type: "laptop",
        lastActive: 1782921600000,
        location: "Local fake mode",
      },
    ],
  });
}

export function TemplateSettingsPanel({
  adapters = createTemplateSettingsMockAdapters(),
  initialTab = "general",
}: {
  readonly adapters?: SettingsAdapters;
  readonly initialTab?: TemplateSettingsTab;
}) {
  const [activeTab, setActiveTab] = useState<TemplateSettingsTab>(initialTab);

  return (
    <SettingsProvider adapters={adapters}>
      <SettingsPanel className="template-settings-panel">
        <SettingsSidebar className="template-settings-sidebar">
          <SettingsSidebarTitle>Settings</SettingsSidebarTitle>
          <SettingsSidebarGroup>
            {templateSettingsTabs.map((tab) => (
              <SettingsTab
                Icon={<span aria-hidden="true">{tab.icon}</span>}
                isActive={activeTab === tab.key}
                key={tab.key}
                name={tab.label}
                onClick={() => setActiveTab(tab.key)}
              />
            ))}
          </SettingsSidebarGroup>
        </SettingsSidebar>
        <SettingsContent className="template-settings-content">
          <SettingsSection title={activeTabLabel(activeTab)}>
            <SettingsRule
              description="Fake/local adapters are active until this client fork explicitly enables live providers."
              title="Provider posture"
            >
              <span>Fake mode</span>
            </SettingsRule>
            <SettingsRule
              description="WorkOS, PostHog, billing, email, storage, and AI provider setup stay behind typed adapters."
              title="Client setup"
            >
              <span>Adapter-backed</span>
            </SettingsRule>
          </SettingsSection>
        </SettingsContent>
      </SettingsPanel>
    </SettingsProvider>
  );
}

function activeTabLabel(tab: TemplateSettingsTab): string {
  return (
    templateSettingsTabs.find((candidate) => candidate.key === tab)?.label ??
    "Settings"
  );
}
