import { resolve } from "node:path";
import { emitControlLaneReceipt } from "./control-lane-receipt.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const workdir = valueAfter("--workdir") ?? process.cwd();
const evidenceRoot = valueAfter("--evidence");
const gates = process.argv.flatMap((value, index) => {
  const gate = process.argv[index + 1];
  return value === "--gate" && gate ? [resolve(gate)] : [];
});
if (!evidenceRoot || gates.length === 0) {
  console.error(
    "usage: record-control-lane --evidence <absolute-dir> --gate <passed-json> [--gate <passed-json> ...] [--workdir <dir>]",
  );
  process.exit(2);
}
const result = emitControlLaneReceipt({
  workdir: resolve(workdir),
  evidenceRoot: resolve(evidenceRoot),
  gateEvidence: gates,
});
console.log(JSON.stringify({ ...result, receipt: result.receipt }, null, 2));
