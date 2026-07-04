import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Layer from "effect/Layer";
import databaseSchema from "./_generated/schema";
import { editorSyncApi } from "./editor/syncApi";
import editorSync from "./editorSync.spec";

const getSnapshot = FunctionImpl.make(
  databaseSchema,
  editorSync,
  "getSnapshot",
  editorSyncApi.getSnapshot,
);

const submitSnapshot = FunctionImpl.make(
  databaseSchema,
  editorSync,
  "submitSnapshot",
  editorSyncApi.submitSnapshot,
);

const latestVersion = FunctionImpl.make(
  databaseSchema,
  editorSync,
  "latestVersion",
  editorSyncApi.latestVersion,
);

const getSteps = FunctionImpl.make(
  databaseSchema,
  editorSync,
  "getSteps",
  editorSyncApi.getSteps,
);

const submitSteps = FunctionImpl.make(
  databaseSchema,
  editorSync,
  "submitSteps",
  editorSyncApi.submitSteps,
);

export default GroupImpl.make(databaseSchema, editorSync).pipe(
  Layer.provide(getSnapshot),
  Layer.provide(submitSnapshot),
  Layer.provide(latestVersion),
  Layer.provide(getSteps),
  Layer.provide(submitSteps),
  GroupImpl.finalize,
);
