import { descriptorFor } from "./src/check-definitions.mts";
import { isDirectRun } from "./src/direct-run.mts";
import { runStaticCheck } from "./src/gate.mts";

export const descriptor = descriptorFor("confect-contracts");
if (isDirectRun(import.meta.url)) await runStaticCheck(descriptor);
