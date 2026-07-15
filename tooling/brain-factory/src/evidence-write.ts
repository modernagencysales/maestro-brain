import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
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
