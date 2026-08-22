"use client";

import * as React from "react";

import { SuiProvider } from "@saas-ui/react";
import {
  Link as TanstackLink,
  type LinkProps as TanstackLinkProps,
} from "@tanstack/react-router";

import { appHotkeys } from "#config/hotkeys.config";
import { system } from "#theme/preset";

import { ModalsProvider } from "../../../components/modals";
import { Hotkeys } from "../components/hotkeys";

const LinkComponent = React.forwardRef<
  HTMLAnchorElement,
  TanstackLinkProps & { href: TanstackLinkProps["to"] }
>(function LinkComponent(props, ref) {
  const { href, ...rest } = props;
  return <TanstackLink ref={ref} to={href} {...rest} />;
});

export interface AppProviderProps {
  onError?: (error: Error, info: React.ErrorInfo) => void;
  children: React.ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = (props) => {
  const { onError, children } = props;

  return (
    <SuiProvider linkComponent={LinkComponent} onError={onError} value={system}>
      <ModalsProvider>
        <Hotkeys hotkeys={appHotkeys}>{children}</Hotkeys>
      </ModalsProvider>
    </SuiProvider>
  );
};
