import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import feedbackDatabaseSchema from "./feedbackDatabase";
import { writeFeedbackReport } from "./feedbackRepository";
import feedback from "./feedback.spec";
import { requireBrainAccess, requireHeadlessBrainAccess } from "./pages.impl";

const now = () =>
  Clock.currentTimeMillis as Effect.Effect<number, never, never>;

const feedbackTenantFor = (tenant: {
  readonly organizationId: string;
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
}) => ({
  organizationId: tenant.organizationId as GenericId<"organizations">,
  organizationKey: tenant.organizationKey,
  workspaceId: tenant.workspaceId,
  brainKey: tenant.brainKey,
});

const reportWrongOrStale = FunctionImpl.make(
  feedbackDatabaseSchema,
  feedback,
  "reportWrongOrStale",
  (args) =>
    Effect.gen(function* () {
      const tenant = yield* requireBrainAccess(args.brainKey, "viewer");
      return yield* writeFeedbackReport({
        tenant: feedbackTenantFor(tenant),
        actor: { kind: "user", id: tenant.actorId },
        input: args,
        createdAt: yield* now(),
      });
    }),
);

const headlessReportWrongOrStale = FunctionImpl.make(
  feedbackDatabaseSchema,
  feedback,
  "headlessReportWrongOrStale",
  (args) =>
    Effect.gen(function* () {
      const tenant = yield* requireHeadlessBrainAccess(args);
      return yield* writeFeedbackReport({
        tenant: feedbackTenantFor(tenant),
        actor: { kind: "service_principal", id: tenant.actorId },
        input: args,
        createdAt: yield* now(),
      });
    }),
);

export default GroupImpl.make(feedbackDatabaseSchema, feedback).pipe(
  Layer.provide(reportWrongOrStale),
  Layer.provide(headlessReportWrongOrStale),
  GroupImpl.finalize,
);
