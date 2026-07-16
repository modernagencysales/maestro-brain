import { runTransientConfectCodegen } from "./transient-confect-codegen.js";

const valuesAfter = (flag: string): string[] => {
  const values: string[] = [];
  for (const [index, argument] of process.argv.entries()) {
    if (argument !== flag) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} requires a value`);
    values.push(value);
  }
  return values;
};

const testPatterns = valuesAfter("--test");
const checks = valuesAfter("--check");
const profiles = valuesAfter("--profile");
const generatedFiles = runTransientConfectCodegen({
  checks,
  profiles,
  root: process.cwd(),
  testPatterns,
});
console.log(
  `transient Confect codegen passed (${generatedFiles.length} generated files)`,
);
