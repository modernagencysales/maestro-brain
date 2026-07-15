import { runTransientConfectCodegen } from "./transient-confect-codegen.js";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const testPattern = valueAfter("--test");
const generatedFiles = runTransientConfectCodegen({
  root: process.cwd(),
  ...(testPattern === undefined ? {} : { testPattern }),
});
console.log(
  `transient Confect codegen passed (${generatedFiles.length} generated files)`,
);
