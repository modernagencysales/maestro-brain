"use client";

import { AppShell, AppShellProps, Sidebar } from "@saas-ui/react";

import { PaymentOverdueBanner } from "#features/billing/components/payment-overdue-banner";

export type AppLayoutProps = AppShellProps;

/**
 * Base layout for app pages.
 */
export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  sidebar,
  ...rest
}) => {
  return (
    <Sidebar.Provider>
      <Sidebar.FlyoutTrigger aria-label="Collapse sidebar" />

      <AppShell
        sidebar={sidebar}
        header={<PaymentOverdueBanner />}
        bg="sidebar.bg"
        {...rest}
      >
        <Sidebar.Inset>{children}</Sidebar.Inset>
      </AppShell>

      <Sidebar.Backdrop />
    </Sidebar.Provider>
  );
};
