"use client";

import * as React from "react";

import { ResizeHandle, ResizeHandler, Resizer } from "@saas-ui-pro/react";
import {
  Badge,
  Box,
  Command,
  HStack,
  IconButton,
  Menu,
  Sidebar,
  Spacer,
  Tooltip,
  useSidebar,
} from "@saas-ui/react";
import { useHotkeysShortcut } from "@saas-ui/use-hotkeys";
import {
  Link,
  type LinkProps,
  createLink,
  useNavigate,
} from "@tanstack/react-router";
import {
  LuBrainCircuit,
  LuBuilding2,
  LuCable,
  LuPanelLeftClose,
  LuPlus,
  LuSearch,
  LuSettings,
} from "react-icons/lu";

import { useModals } from "@workspace/ui/modals";

import { useUserSettings } from "../../../lib/user-settings/use-user-settings";

import { BillingStatus } from "./billing-status";
import { InvitePeopleDialog } from "./invite-people";
import { UserMenu } from "./user-menu";
import { WorkspacesMenu } from "./workspaces-menu";

export type AppSidebarProps = Sidebar.RootProps;

export const AppSidebar: React.FC<AppSidebarProps> = (props) => {
  const modals = useModals();

  const [{ sidebarWidth }, setUserSettings] = useUserSettings();

  const onResize: ResizeHandler = ({ width }) => {
    setUserSettings("sidebarWidth", width);
  };

  const { mode, setMode, open, setOpen, isMobile } = useSidebar();

  return (
    <Resizer
      defaultWidth={sidebarWidth}
      onResize={onResize}
      enabled={!isMobile && open}
    >
      <Sidebar.Root {...props}>
        <Sidebar.Header alignItems="center" gap="1">
          <React.Suspense>
            <WorkspacesMenu />
          </React.Suspense>

          <Spacer />
          <IconButton
            variant="ghost"
            size="xs"
            aria-label="Collapse sidebar"
            onClick={() => setOpen(!open)}
          >
            <LuPanelLeftClose size="1.1em" />
          </IconButton>
          <IconButton
            variant="ghost"
            size="xs"
            rounded="full"
            aria-label="Search"
            asChild
          >
            <Link to="/clients">
              <LuSearch size="1.1em" />
            </Link>
          </IconButton>
          <React.Suspense>
            <UserMenu />
          </React.Suspense>
        </Sidebar.Header>

        <Sidebar.Body>
          <Sidebar.Group>
            <AppSidebarLink
              to="/clients"
              activeOptions={{
                exact: false,
              }}
              label="Clients"
              icon={<LuBuilding2 />}
              hotkey="navigation.dashboard"
            />
            <AppSidebarLink
              to="/brain"
              activeOptions={{
                exact: false,
              }}
              label="Agency Brain"
              icon={<LuBrainCircuit />}
              hotkey="navigation.inbox"
            />
            <AppSidebarLink
              to="/connections"
              activeOptions={{
                exact: false,
              }}
              label="Connections"
              icon={<LuCable />}
              hotkey="navigation.contacts"
            />
            <AppSidebarLink
              to="/settings"
              activeOptions={{ exact: false }}
              label="Settings"
              icon={<LuSettings />}
              hotkey="navigation.settings"
            />
          </Sidebar.Group>

          <Sidebar.Group>
            <Sidebar.GroupHeader>
              <Sidebar.GroupTitle>Teams</Sidebar.GroupTitle>
            </Sidebar.GroupHeader>
            <Sidebar.NavItem onClick={() => modals.open(InvitePeopleDialog)}>
              <Sidebar.NavButton>
                <LuPlus />
                Invite people
              </Sidebar.NavButton>
            </Sidebar.NavItem>
          </Sidebar.Group>
        </Sidebar.Body>

        <Sidebar.Footer>
          <BillingStatus />

          <HStack>
            <Menu.Root>
              <Menu.Trigger asChild>
                <IconButton
                  variant="surface"
                  size="sm"
                  rounded="full"
                  aria-label="Search"
                >
                  ?
                </IconButton>
              </Menu.Trigger>
              <Menu.Content minW="200px">
                <Menu.ItemGroup title="Help">
                  <Menu.Item asChild value="docs">
                    <a href="https://saas-ui.dev/docs" target="_blank">
                      Documentation
                    </a>
                  </Menu.Item>
                  <Menu.Item asChild value="discord">
                    <a href="https://saas-ui.dev/discord" target="_blank">
                      Discord community
                    </a>
                  </Menu.Item>
                </Menu.ItemGroup>
              </Menu.Content>
            </Menu.Root>
          </HStack>
        </Sidebar.Footer>

        <Sidebar.Track
          asChild
          onClick={() => {
            if (mode === "flyout") {
              setMode("collapsible");
              setOpen(true);
            } else {
              setMode("flyout");
            }
          }}
        >
          <ResizeHandle aria-label="Collapse sidebar" />
        </Sidebar.Track>
      </Sidebar.Root>
    </Resizer>
  );
};

interface AppSidebarlink
  extends Sidebar.NavItemProps, Pick<LinkProps, "to" | "activeOptions"> {
  hotkey: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
}

const AppSidebarLink = (props: AppSidebarlink) => {
  const { to, activeOptions, icon, label, hotkey, badge, ...rest } = props;

  const navigate = useNavigate();

  const command = useHotkeysShortcut(hotkey, () => {
    navigate({
      to,
    });
  }, [to]);

  return (
    <Tooltip
      content={
        <>
          {label} <Command size="sm">{command}</Command>
        </>
      }
      positioning={{
        placement: "right",
      }}
      openDelay={1000}
      portalled
    >
      <Sidebar.NavItem {...rest}>
        <NavLink
          to={to}
          activeProps={{
            "data-active": true,
          }}
          activeOptions={activeOptions}
        >
          {icon}

          <Box as="span" lineClamp={1}>
            {label}
          </Box>

          {typeof badge !== "undefined" ? (
            <Badge borderRadius="sm" ms="auto" px="1.5" bg="none">
              {badge}
            </Badge>
          ) : null}
        </NavLink>
      </Sidebar.NavItem>
    </Tooltip>
  );
};

const NavLink = createLink(Sidebar.NavButton);
