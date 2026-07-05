import { createFileRoute } from "@tanstack/react-router";
import { TemplateMainContent } from "@maestro-template/ui";
import { NotificationCenterSurface } from "../features/notifications/notification-center-surface";

export const Route = createFileRoute("/_workspace/notifications")({
  component: NotificationsRoute,
});

function NotificationsRoute() {
  return (
    <TemplateMainContent className="template-page">
      <article className="template-readable-page">
        <p className="eyebrow">Communication</p>
        <h1>Notifications</h1>
        <p>
          Recorded in-app notices, read state, and channel preferences start in
          fake-safe mode before a fork enables live delivery.
        </p>
        <NotificationCenterSurface />
      </article>
    </TemplateMainContent>
  );
}
