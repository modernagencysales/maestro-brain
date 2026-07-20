import { validatePreservedResumeLaunch } from "./preserved-resume-validation.js";
import { gitCommonDir } from "./process.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const mode = required("BRAIN_RESUME_MODE");
if (mode !== "preserved-worktree" && mode !== "preserved-conflict-aware") {
  throw new Error(`unsupported preserved resume mode ${mode}`);
}
const controlRoot = required("BRAIN_CONTROL_ROOT");
const controlCommonDir = required("BRAIN_CONTROL_COMMON_DIR");
if (gitCommonDir(controlRoot) !== controlCommonDir) {
  throw new Error("control common directory changed after launch");
}
const result = validatePreservedResumeLaunch({
  baseSha: required("BRAIN_BASE_SHA"),
  branch: required("BRAIN_RESUME_BRANCH"),
  controlCommonDir,
  evidence: required("BRAIN_EVIDENCE_DIR"),
  expectedCommit: required("BRAIN_RESUME_EXPECTED_COMMIT"),
  mode,
  proofHead: required("BRAIN_RESUME_PROOF_HEAD"),
  resumeCommits: required("BRAIN_RESUME_COMMITS").split(","),
  sourceHeadSha: required("BRAIN_RESUME_SOURCE_HEAD"),
  startSha: required("BRAIN_START_SHA"),
  taskId: required("BRAIN_TASK_ID"),
  taskBaseSha: required("BRAIN_RESUME_TASK_BASE"),
  workdir: required("BRAIN_WORKDIR"),
});
console.log(JSON.stringify(result));
