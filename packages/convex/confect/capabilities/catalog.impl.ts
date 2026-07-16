import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import catalog from "./catalog.spec";

const capabilities = [
  {
    key: "brain.page.create",
    name: "Create Brain page",
    description: "Stores a cited markdown note in the workspace Brain.",
    headlessExposure: "web",
    requiresApproval: false,
  },
  {
    key: "workflow.contextPack.compile",
    name: "Compile context pack",
    description:
      "Collects approved Brain source material for a workflow or agent run.",
    headlessExposure: "mcp",
    requiresApproval: false,
  },
  {
    key: "agent.workflow.compose",
    name: "Compose workflow",
    description:
      "Lets a governed agent propose a workflow from available capabilities.",
    headlessExposure: "web",
    requiresApproval: true,
  },
] as const;

const list = FunctionImpl.make(databaseSchema, catalog, "list", () =>
  Effect.succeed(capabilities),
);

export default GroupImpl.make(databaseSchema, catalog).pipe(
  Layer.provide(list),
  GroupImpl.finalize,
);
