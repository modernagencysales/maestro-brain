import type { Ref } from "@confect/core";
import type { TemplateConfectRefs } from "@maestro-template/convex/refs";
import { describe, expect, it } from "vitest";
import {
  fakeNotificationCenterView,
  presentNotificationCenter,
} from "./notification-center-surface";

type ListNotificationsRef =
  TemplateConfectRefs["public"]["ops"]["notifications"]["list"];
type NotificationCenterData = Ref.Returns<ListNotificationsRef>;
type NotificationCenterError = Ref.Error<ListNotificationsRef>;

const liveCenter = {
  notifications: [
    {
      notificationId: "notificationRecords_live_1",
      workspaceId: "workspaces_live_1",
      recipientId: "users_live_1",
      idempotencyKey: "workflow.done.1",
      title: "Workflow finished",
      body: "The live workflow notification was persisted.",
      category: "workflow",
      priority: "normal",
      delivery: "test",
      createdAt: 1_700_000_000_000,
      readAt: 1_700_000_010_000,
      actionHref: "/runs",
    },
  ],
  preferences: [
    {
      workspaceId: "workspaces_live_1",
      recipientId: "users_live_1",
      category: "workflow",
      inApp: true,
      email: false,
      digest: true,
    },
  ],
  summary: {
    total: 1,
    unread: 0,
    mutedCategories: [],
    liveDeliveryReady: false,
  },
} as unknown as NotificationCenterData;

describe("notification center surface presenter", () => {
  it("keeps an honest fake-safe view when the live backend is skipped", () => {
    const view = presentNotificationCenter({ status: "skipped" });

    expect(view).toMatchObject({
      live: false,
      status: "unconfigured",
      summary: { total: 3, unread: 2 },
    });
    expect(view.notifications.map((notification) => notification.id)).toEqual([
      "notification_workflow_ready",
      "notification_provider_review",
      "notification_billing_fake",
    ]);
  });

  it("maps live Confect notification rows into platform UI records", () => {
    const view = presentNotificationCenter({
      status: "ready",
      mode: "read",
      data: liveCenter,
    });

    expect(view).toEqual({
      live: true,
      status: "ready",
      notifications: [
        {
          id: "notificationRecords_live_1",
          title: "Workflow finished",
          body: "The live workflow notification was persisted.",
          category: "workflow",
          priority: "normal",
          delivery: "test",
          createdAt: "2023-11-14T22:13:20.000Z",
          readAt: "2023-11-14T22:13:30.000Z",
          actionHref: "/runs",
        },
      ],
      preferences: [
        {
          category: "workflow",
          inApp: true,
          email: false,
          digest: true,
        },
      ],
      summary: liveCenter.summary,
    });
  });

  it("keeps generated preferences visible for an empty live inbox", () => {
    const emptyLiveCenter = {
      ...liveCenter,
      notifications: [],
      summary: {
        total: 0,
        unread: 0,
        mutedCategories: ["workflow"],
        liveDeliveryReady: false,
      },
    } as NotificationCenterData;

    const view = presentNotificationCenter({
      status: "empty",
      data: emptyLiveCenter,
    });

    expect(view).toMatchObject({
      live: true,
      status: "empty",
      notifications: [],
      summary: emptyLiveCenter.summary,
      preferences: [
        {
          category: "workflow",
          inApp: true,
          email: false,
          digest: true,
        },
      ],
    });
  });

  it("uses the fake-safe view with an unavailable status for typed failures", () => {
    const view = presentNotificationCenter({
      status: "typed_failure",
      error: {
        _tag: "WorkspaceNotFound",
        workspaceId: "workspaces_missing",
      } as unknown as NotificationCenterError,
    });

    expect(view.live).toBe(false);
    expect(view.status).toBe("unavailable");
    expect(view.detail).toBe("WorkspaceNotFound");
    expect(view.notifications).toEqual(
      fakeNotificationCenterView().notifications,
    );
  });
});
