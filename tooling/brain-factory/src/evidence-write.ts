import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const fileSha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");

export const jsonContent = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export const atomicWrite = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.next`;
  if (existsSync(temporary)) {
    if (readFileSync(temporary, "utf8") !== content) {
      throw new Error(`${path}: stale adoption write differs from replay`);
    }
  } else {
    writeFileSync(temporary, content, { flag: "wx" });
  }
  renameSync(temporary, path);
};

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;

export const acquireEvidenceWriteLock = (path: string): (() => void) => {
  try {
    mkdirSync(path);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new Error(`evidence adoption lock already exists at ${path}`);
    }
    throw error;
  }
  return () => rmSync(path, { recursive: true });
};
