#!/usr/bin/env node
import process from "node:process";
import { tsImport } from "tsx/esm/api";

const cli = await tsImport("../src/index.ts", import.meta.url);
const result = await cli.runCliAsync(
  process.argv.slice(2),
  cli.decodeCliRuntimeConfig(process.env),
);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
