"use client";

import { IconButton } from "@chakra-ui/react";
import { Menu } from "@saas-ui/react";
import { useHotkeysShortcut } from "@saas-ui/use-hotkeys";
import { Link, useNavigate } from "@tanstack/react-router";

import { useColorMode } from "../../../components/color-mode.tsx";
import { UserAvatar } from "../../../components/user-avatar";

import { useCurrentUser } from "../hooks/use-current-user";

export const UserMenu = () => {
  const navigate = useNavigate();

  const [currentUser] = useCurrentUser();

  const logOutAndClearCache = () => {
    void navigate({ to: "/logout" });
  };

  const { toggleColorMode, colorMode } = useColorMode();

  const logoutCommand = useHotkeysShortcut("general.logout", () => {
    logOutAndClearCache();
  });

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton
          variant="ghost"
          aria-label="User menu"
          rounded="full"
          size="xs"
        >
          <UserAvatar size="xs" user={currentUser} presence="online" />
        </IconButton>
      </Menu.Trigger>

      <Menu.Content minW="200px" portalled>
        <Menu.ItemGroup title={currentUser?.name || ""}>
          <Menu.Item value="profile" asChild>
            <Link to="/settings">Profile</Link>
          </Menu.Item>
          <Menu.Item value="settings" asChild>
            <Link to="/settings">Settings</Link>
          </Menu.Item>
        </Menu.ItemGroup>
        <Menu.Separator />
        <Menu.Item
          value="toggle-color-mode"
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            toggleColorMode();
          }}
        >
          {colorMode === "dark" ? "Light mode" : "Dark mode"}
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item value="logout" onClick={() => logOutAndClearCache()}>
          Log out
          <Menu.ItemCommand>{logoutCommand}</Menu.ItemCommand>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
};
