import { Avatar, type AvatarProps, Menu, Spacer, Text } from "@saas-ui/react";
import { LuCheck } from "react-icons/lu";

import { useWorkspace } from "../../../providers/workspace";

const WorkspaceLogo: React.FC<AvatarProps> = (props) => {
  const { src, ...rest } = props;
  return (
    <Avatar
      display="inline-flex"
      src={src}
      size="xs"
      borderRadius="full"
      {...rest}
    />
  );
};

export const WorkspacesMenu: React.FC = () => {
  const workspace = useWorkspace();
  const workspaces = workspace.status === "ready" ? workspace.workspaces : [];
  const activeWorkspace =
    workspace.status === "ready" ? workspace.activeWorkspace : undefined;

  const activeLogo = (
    <WorkspaceLogo name={activeWorkspace?.name ?? "Maestro Brain"} />
  );

  return (
    <Menu.Root>
      <Menu.Button
        aria-label={`Current workspace is ${activeWorkspace?.name ?? "Maestro Brain"}`}
        variant="ghost"
        px="2"
        size="xs"
      >
        {activeLogo} {activeWorkspace?.name ?? "Maestro Brain"}
      </Menu.Button>

      <Menu.Content minW="200px" portalled>
        <Menu.ItemGroup title="Workspaces">
          {workspaces.map(({ workspaceId, name }) => {
            return (
              <Menu.Item
                key={workspaceId}
                value={workspaceId}
                onClick={() => workspace.switchWorkspace(workspaceId)}
              >
                <WorkspaceLogo name={name} />

                <Text>{name}</Text>
                <Spacer />
                {workspaceId === activeWorkspace?.workspaceId ? (
                  <LuCheck />
                ) : null}
              </Menu.Item>
            );
          })}
        </Menu.ItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
};
