import { runIntegrationBroadGate } from "./integration-broad-gate.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const workdir = valueAfter("--workdir");
const evidenceDirectory = valueAfter("--evidence");
const integrationId = valueAfter("--integration-id");
if (!workdir || !evidenceDirectory || !integrationId) {
  throw new Error(
    "usage: integration-broad-gate --workdir ... --evidence ... --integration-id ...",
  );
}

const receipt = runIntegrationBroadGate({
  evidenceDirectory,
  integrationId,
  workdir,
});
console.log(
  `${integrationId}: broad gate passed at ${receipt.headSha} after ${receipt.attempts.length} attempt(s)`,
);
