import { describe, expect, it } from "vitest";

import { normalizeDriveText } from "./canonical";
import { buildDrivePassages } from "./passages";

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

describe("Google Drive deterministic passages", () => {
  it("normalizes Unicode and line endings deterministically", () => {
    expect(normalizeDriveText("Cafe\u0301  \r\n\r\n\r\nNext\t \r\n")).toBe(
      "Café\n\nNext",
    );
  });

  it("builds stable heading-aware passages with UTF-8 byte offsets", () => {
    const text = normalizeDriveText(
      "# Market\n\nAlpha paragraph.\n\n## Economics\n\nPrice is $10.",
    );
    const first = buildDrivePassages({
      providerRevisionKey: "file_1:version:1",
      normalizedText: text,
    });
    const second = buildDrivePassages({
      providerRevisionKey: "file_1:version:1",
      normalizedText: text,
    });

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      ordinal: 0,
      startOffset: 0,
      endOffset: bytes(text),
      headingPath: ["Market"],
    });
    expect(first[0]?.passageKey).toMatch(/^gdp_[a-f0-9]{64}$/);
  });

  it("keeps every passage within 8 KiB with at most 512 bytes of paragraph overlap", () => {
    const paragraphs = Array.from(
      { length: 80 },
      (_, index) => `## Section ${index}\n\n${"évidence ".repeat(45)}${index}.`,
    );
    const text = normalizeDriveText(paragraphs.join("\n\n"));
    const passages = buildDrivePassages({
      providerRevisionKey: "file_1:version:2",
      normalizedText: text,
    });

    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) {
      expect(bytes(passage.text)).toBeLessThanOrEqual(8 * 1024);
      expect(passage.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
    for (let index = 1; index < passages.length; index += 1) {
      const previous = passages[index - 1];
      const current = passages[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (!previous || !current) continue;
      expect(previous.endOffset - current.startOffset).toBeGreaterThanOrEqual(
        0,
      );
      expect(previous.endOffset - current.startOffset).toBeLessThanOrEqual(512);
    }
  });
});
