import { Badge } from "@notion-kit/ui/primitives";

export type NotificationDeliveryState = "fake" | "test" | "live-ready";

export type PlatformNotification = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly delivery: NotificationDeliveryState;
  readonly createdAt: string;
};

export function TemplateNotificationCenter({
  notifications,
}: {
  readonly notifications: readonly PlatformNotification[];
}) {
  return (
    <section
      aria-label="Notification center"
      className="template-notifications"
    >
      {notifications.length === 0 ? (
        <p className="template-platform-empty">No notifications yet</p>
      ) : (
        <div className="template-notification-list">
          {notifications.map((notification) => (
            <article
              className="template-notification-row"
              key={notification.id}
            >
              <header>
                <h2>{notification.title}</h2>
                <Badge>{notification.delivery}</Badge>
              </header>
              <p>{notification.body}</p>
              <time dateTime={notification.createdAt}>
                {notification.createdAt}
              </time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
