import { descriptorFor } from "./src/check-definitions.mts";
import { isDirectRun } from "./src/direct-run.mts";
import { runStaticCheck } from "./src/gate.mts";

export const descriptor = descriptorFor("schema-migration-notes");
if (isDirectRun(import.meta.url)) await runStaticCheck(descriptor);
