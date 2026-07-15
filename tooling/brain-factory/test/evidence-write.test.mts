import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireEvidenceWriteLock,
  atomicWrite,
} from "../src/evidence-write.js";

const roots: string[] = [];

const root = (): string => {
  const value = mkdtempSync(resolve(tmpdir(), "brain-evidence-write-"));
  roots.push(value);
  return value;
};

afterEach(() => {
  for (const value of roots.splice(0)) {
    rmSync(value, { force: true, recursive: true });
  }
});

describe("evidence atomic writes", () => {
  it("finishes an identical crash-residue next file", () => {
    const path = resolve(root(), "record.json");
    writeFileSync(`${path}.next`, "next\n");
    atomicWrite(path, "next\n");
    expect(readFileSync(path, "utf8")).toBe("next\n");
    expect(existsSync(`${path}.next`)).toBe(false);
  });

  it("fails closed on stale next-file content", () => {
    const path = resolve(root(), "record.json");
    writeFileSync(path, "current\n");
    writeFileSync(`${path}.next`, "foreign\n");
    expect(() => atomicWrite(path, "desired\n")).toThrow(
      /stale adoption write differs from replay/,
    );
    expect(readFileSync(path, "utf8")).toBe("current\n");
    expect(readFileSync(`${path}.next`, "utf8")).toBe("foreign\n");
  });

  it("allows one evidence writer and rejects a concurrent owner", () => {
    const path = resolve(root(), "adoption.lock");
    const release = acquireEvidenceWriteLock(path);
    expect(() => acquireEvidenceWriteLock(path)).toThrow(
      /evidence adoption lock already exists/,
    );
    release();
    const releaseReplay = acquireEvidenceWriteLock(path);
    releaseReplay();
  });
});
