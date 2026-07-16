import {
  parseTransientConfectArgs,
  runTransientConfectCodegen,
} from "./transient-confect-codegen.js";

const { checks, profiles, testPatterns } = parseTransientConfectArgs(
  process.argv.slice(2),
);
const generatedFiles = runTransientConfectCodegen({
  checks,
  profiles,
  root: process.cwd(),
  testPatterns,
});
console.log(
  `transient Confect codegen passed (${generatedFiles.length} generated files)`,
);
