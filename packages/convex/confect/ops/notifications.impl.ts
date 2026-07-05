import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import { Forbidden, NotFound, ValidationFailed } from "../errors";
import { validateCallerIdempotencyKey } from "../shared/idempotencyKey";
import notifications from "./notifications.spec";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const LIST_SCAN_CAP = 500;
const notificationCategories = [
  "workspace",
  "workflow",
  "billing",
  "security",
  "system",
] as const;

const unsafeAssumeClockProvided = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const list = FunctionImpl.make(
  databaseSchema,
  notifications,
  "list",
  ({ workspaceId, limit }) =>
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const reader = yield* DatabaseReader;
      const rows = yield* reader
        .table("notificationRecords")
        .index("by_recipient_created", (q) =>
          q.eq("workspaceId", workspaceId).eq("recipientId", access.userId),
        )
        .take(LIST_SCAN_CAP)
        .pipe(Effect.orDie);
      const preferences = yield* reader
        .table("notificationPreferences")
        .index("by_recipient", (q) =>
          q.eq("workspaceId", workspaceId).eq("recipientId", access.userId),
        )
        .take(notificationCategories.length)
        .pipe(Effect.orDie);
      const effectivePreferences = notificationCategories.map((category) => {
        const existing = preferences.find(
          (preference) => preference.category === category,
        );

        return existing === undefined
          ? defaultPreferenceFor(workspaceId, access.userId, category)
          : {
              preferenceId: existing._id,
              workspaceId,
              recipientId: access.userId,
              category,
              inApp: existing.inApp,
              email: existing.email,
              digest: existing.digest,
              updatedAt: existing.updatedAt,
            };
      });
      const preferenceByCategory = new Map(
        effectivePreferences.map((preference) => [
          preference.category,
          preference,
        ]),
      );
      const visibleNotifications = rows
        .map(toNotificationReturn)
        .filter(
          (notification) =>
            preferenceByCategory.get(notification.category)?.inApp ?? true,
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, Math.min(limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));

      return {
        notifications: visibleNotifications,
        preferences: effectivePreferences,
        summary: {
          total: visibleNotifications.length,
          unread: visibleNotifications.filter(
            (notification) => notification.readAt === undefined,
          ).length,
          mutedCategories: effectivePreferences
            .filter((preference) => !preference.inApp)
            .map((preference) => preference.category),
          liveDeliveryReady: visibleNotifications.some(
            (notification) => notification.delivery === "live-ready",
          ),
        },
      };
    }),
);

const recordInternal = FunctionImpl.make(
  databaseSchema,
  notifications,
  "recordInternal",
  (input) =>
    Effect.gen(function* () {
      const idempotencyKey = validateCallerIdempotencyKey(input.idempotencyKey);

      if (!idempotencyKey.ok) {
        return yield* new ValidationFailed({
          field: "idempotencyKey",
          message: idempotencyKey.error.message,
        });
      }

      const createdAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const reader = yield* DatabaseReader;
      const existing = yield* reader
        .table("notificationRecords")
        .index("by_idempotency", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("recipientId", input.recipientId)
            .eq("idempotencyKey", idempotencyKey.value),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);

      if (existing !== null) {
        return toNotificationReturn(existing);
      }

      const writer = yield* DatabaseWriter;
      const notificationId = yield* writer
        .table("notificationRecords")
        .insert({
          workspaceId: input.workspaceId,
          recipientId: input.recipientId,
          idempotencyKey: idempotencyKey.value,
          title: input.title,
          body: input.body,
          category: input.category,
          priority: input.priority,
          delivery: input.delivery,
          createdAt,
          createdAtDescending: -createdAt,
          ...(input.actionHref === undefined
            ? {}
            : { actionHref: input.actionHref }),
        })
        .pipe(Effect.orDie);

      return {
        notificationId,
        workspaceId: input.workspaceId,
        recipientId: input.recipientId,
        idempotencyKey: idempotencyKey.value,
        title: input.title,
        body: input.body,
        category: input.category,
        priority: input.priority,
        delivery: input.delivery,
        createdAt,
        ...(input.actionHref === undefined
          ? {}
          : { actionHref: input.actionHref }),
      };
    }),
);

const markRead = FunctionImpl.make(
  databaseSchema,
  notifications,
  "markRead",
  ({ workspaceId, notificationId }) =>
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const notification = yield* reader
        .table("notificationRecords")
        .get(notificationId)
        .pipe(Effect.orDie);

      if (notification === null) {
        return yield* new NotFound({
          resource: "notificationRecords",
          id: notificationId,
        });
      }

      yield* requireOwnNotification(notification, workspaceId, access.userId);

      const readAt =
        notification.readAt ??
        (yield* unsafeAssumeClockProvided(Clock.currentTimeMillis));

      if (notification.readAt === undefined) {
        yield* writer
          .table("notificationRecords")
          .patch(notificationId, { readAt })
          .pipe(Effect.orDie);
      }

      return toNotificationReturn({ ...notification, readAt });
    }),
);

const updatePreference = FunctionImpl.make(
  databaseSchema,
  notifications,
  "updatePreference",
  ({ workspaceId, category, inApp, email, digest }) =>
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const updatedAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const existing = yield* reader
        .table("notificationPreferences")
        .index("by_recipient_category", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .eq("recipientId", access.userId)
            .eq("category", category),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);

      if (existing === null) {
        const preferenceId = yield* writer
          .table("notificationPreferences")
          .insert({
            workspaceId,
            recipientId: access.userId,
            category,
            inApp,
            email,
            digest,
            updatedAt,
          })
          .pipe(Effect.orDie);

        return {
          preferenceId,
          workspaceId,
          recipientId: access.userId,
          category,
          inApp,
          email,
          digest,
          updatedAt,
        };
      }

      yield* writer
        .table("notificationPreferences")
        .patch(existing._id, {
          inApp,
          email,
          digest,
          updatedAt,
        })
        .pipe(Effect.orDie);

      return {
        preferenceId: existing._id,
        workspaceId,
        recipientId: access.userId,
        category,
        inApp,
        email,
        digest,
        updatedAt,
      };
    }),
);

const requireOwnNotification = (
  notification: {
    readonly workspaceId: string;
    readonly recipientId: string;
  },
  workspaceId: GenericId<"workspaces">,
  userId: GenericId<"users">,
) =>
  notification.workspaceId === workspaceId &&
  notification.recipientId === userId
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          reason: "Notification is not visible to this workspace member.",
        }),
      );

const defaultPreferenceFor = (
  workspaceId: GenericId<"workspaces">,
  recipientId: GenericId<"users">,
  category: (typeof notificationCategories)[number],
) => ({
  workspaceId,
  recipientId,
  category,
  inApp: true,
  email: category === "security" || category === "system",
  digest: category !== "security",
});

const toNotificationReturn = (notification: {
  readonly _id: GenericId<"notificationRecords">;
  readonly workspaceId: GenericId<"workspaces"> | string;
  readonly recipientId: GenericId<"users"> | string;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly body: string;
  readonly category:
    "workspace" | "workflow" | "billing" | "security" | "system";
  readonly priority: "low" | "normal" | "high";
  readonly delivery: "fake" | "test" | "live-ready";
  readonly createdAt: number;
  readonly createdAtDescending?: number | undefined;
  readonly readAt?: number | undefined;
  readonly actionHref?: string | undefined;
}) => ({
  notificationId: notification._id,
  workspaceId: notification.workspaceId as GenericId<"workspaces">,
  recipientId: notification.recipientId as GenericId<"users">,
  idempotencyKey: notification.idempotencyKey,
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

export default GroupImpl.make(databaseSchema, notifications).pipe(
  Layer.provide(list),
  Layer.provide(recordInternal),
  Layer.provide(markRead),
  Layer.provide(updatePreference),
  GroupImpl.finalize,
);
