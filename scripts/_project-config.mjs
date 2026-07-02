#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const config = JSON.parse(
  readFileSync(resolve(repoRoot, "project.config.json"), "utf8"),
);

const [command, environmentName, field] = process.argv.slice(2);

const environment = (name) => {
  const selected = config.environments?.[name];
  if (!selected) {
    throw new Error(`Unknown environment: ${name}`);
  }
  return selected;
};

if (command === "get") {
  if (!environmentName || !field) {
    throw new Error("Usage: _project-config.mjs get <environment> <field>");
  }
  const value = environment(environmentName)[field];
  if (typeof value !== "string") {
    throw new Error(`Field is not a string: ${field}`);
  }
  process.stdout.write(`${value}\n`);
} else if (command === "required-secrets") {
  if (!environmentName) {
    throw new Error(
      "Usage: _project-config.mjs required-secrets <environment>",
    );
  }
  process.stdout.write(
    `${environment(environmentName).requiredSecrets.join("\n")}\n`,
  );
} else {
  throw new Error(
    "Usage: _project-config.mjs get <environment> <field> | required-secrets <environment>",
  );
}
