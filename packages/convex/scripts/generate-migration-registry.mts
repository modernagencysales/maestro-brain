import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] ?? "") : undefined;
const mode = args.includes("--write") ? "write" : args.includes("--check") ? "check" : undefined;
if (!root || !mode || (args.includes("--write") && args.includes("--check")))
  throw new Error("usage: --root <absolute> (--check|--write)");
if (mode === "write")
  writeFileSync(join(root, "packages/convex/confect/internal/migrations.generated.ts"), "// generated registry placeholder\n");
