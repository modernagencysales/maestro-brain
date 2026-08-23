import { componentsGeneric } from "convex/server";

export type Components = {
  "agent": import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  "migrations": import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  "posthog": import("@posthog/convex/_generated/component.js").ComponentApi<"posthog">;
  "prosemirrorSync": import("@convex-dev/prosemirror-sync/_generated/component.js").ComponentApi<"prosemirrorSync">;
  "workflow": import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  "workpool": import("@convex-dev/workpool/_generated/component.js").ComponentApi<"workpool">;
};

export const components: Components = componentsGeneric() as any;
