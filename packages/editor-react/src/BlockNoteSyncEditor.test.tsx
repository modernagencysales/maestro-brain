import { describe, expect, it } from "vitest";
import {
  nextBlockNoteSnapshotVersion,
  readBlockNoteDocumentSnapshot,
  shouldBootstrapCreate,
} from "./BlockNoteSyncEditor";

describe("BlockNoteSyncEditor decisions", () => {
  it("bootstraps only once after loading settles with no editor", () => {
    expect(
      shouldBootstrapCreate(false, { isLoading: true, editor: null }),
    ).toBe(false);
    expect(
      shouldBootstrapCreate(false, { isLoading: false, editor: null }),
    ).toBe(true);
    expect(
      shouldBootstrapCreate(true, { isLoading: false, editor: null }),
    ).toBe(false);
    expect(shouldBootstrapCreate(false, { isLoading: false, editor: {} })).toBe(
      false,
    );
  });
});

describe("BlockNoteSyncEditor callbacks", () => {
  it("serializes the live BlockNote document for fenced saves", () => {
    expect(
      readBlockNoteDocumentSnapshot({
        document: [{ type: "paragraph" }],
      } as never),
    ).toBe('[{"type":"paragraph"}]');
    expect(readBlockNoteDocumentSnapshot(null)).toBeNull();
  });

  it("increments deterministic live snapshot versions from the selected snapshot", () => {
    expect(nextBlockNoteSnapshotVersion(41)).toBe(42);
    expect(nextBlockNoteSnapshotVersion(nextBlockNoteSnapshotVersion(41))).toBe(
      43,
    );
  });
});
