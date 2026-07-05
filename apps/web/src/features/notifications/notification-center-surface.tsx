import { useMemo, useState } from "react";
import {
  TemplateNotificationCenter,
  type PlatformNotification,
  type PlatformNotificationPreference,
} from "@maestro-template/ui";
import {
  buildNotificationCenterView,
  defaultNotificationPreferences,
  markNotificationRead,
  type NotificationRecord,
} from "@maestro-template/notifications";

const fakeNotifications: readonly NotificationRecord[] = [
  {
    id: "notification_workflow_ready",
    workspaceId: "workspace_template",
    recipientId: "user_template_admin",
    title: "Workflow run ready",
    body: "The sample GTM workflow finished in fake mode and is ready for review.",
    category: "workflow",
    priority: "normal",
    delivery: "fake",
    createdAt: "2026-07-05T14:00:00.000Z",
    actionHref: "/runs",
  },
  {
    id: "notification_provider_review",
    workspaceId: "workspace_template",
    recipientId: "user_template_admin",
    title: "Provider review needed",
    body: "Email delivery is still recorded-only until domain and sender posture are approved.",
    category: "system",
    priority: "high",
    delivery: "test",
    createdAt: "2026-07-05T13:30:00.000Z",
  },
  {
    id: "notification_billing_fake",
    workspaceId: "workspace_template",
    recipientId: "user_template_admin",
    title: "Billing remains fake-safe",
    body: "Dodo checkout is disabled until a fork completes the live billing checklist.",
    category: "billing",
    priority: "low",
    delivery: "fake",
    createdAt: "2026-07-05T12:00:00.000Z",
    readAt: "2026-07-05T12:10:00.000Z",
    actionHref: "/billing",
  },
];

const toPlatformNotification = (
  notification: NotificationRecord,
): PlatformNotification => ({
  id: notification.id,
  title: notification.title,
  body: notification.body,
  category: notification.category,
  priority: notification.priority,
  delivery: notification.delivery,
  createdAt: notification.createdAt,
  ...(notification.readAt === undefined ? {} : { readAt: notification.readAt }),
  ...(notification.actionHref === undefined
    ? {}
    : { actionHref: notification.actionHref }),
});

const toPlatformPreference = (
  preference: (typeof defaultNotificationPreferences)[number],
): PlatformNotificationPreference => ({
  category: preference.category,
  inApp: preference.inApp,
  email: preference.email,
  digest: preference.digest,
});

export function NotificationCenterSurface() {
  const [notifications, setNotifications] =
    useState<readonly NotificationRecord[]>(fakeNotifications);
  const view = useMemo(
    () =>
      buildNotificationCenterView({
        notifications,
        preferences: defaultNotificationPreferences,
      }),
    [notifications],
  );

  return (
    <TemplateNotificationCenter
      notifications={view.notifications.map(toPlatformNotification)}
      onMarkRead={(notificationId) => {
        setNotifications((current) =>
          current.map((notification) =>
            notification.id === notificationId
              ? markNotificationRead({
                  notification,
                  readAt: new Date().toISOString(),
                })
              : notification,
          ),
        );
      }}
      preferences={view.preferences.map(toPlatformPreference)}
      summary={view.summary}
    />
  );
}
