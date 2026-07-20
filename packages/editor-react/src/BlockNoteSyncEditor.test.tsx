import { describe, expect, it } from "vitest";
import {
  nextBlockNoteSnapshotVersion,
  readBlockNoteDocumentSnapshot,
  readBlockNoteRevisionFence,
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

describe("BlockNoteSyncEditor revision fences", () => {
  it("keeps same-document saves fenced to the revision selected at edit start", () => {
    expect(
      readBlockNoteRevisionFence(
        { documentId: "brainPage:br_01:pg_overview", revisionKey: "rev_start" },
        {
          documentId: "brainPage:br_01:pg_overview",
          revisionKey: "rev_after_remote_save",
        },
      ),
    ).toBe("rev_start");
    expect(
      readBlockNoteRevisionFence(
        { documentId: "brainPage:br_01:pg_overview", revisionKey: "rev_start" },
        { documentId: "brainPage:br_01:pg_next", revisionKey: "rev_next" },
      ),
    ).toBe("rev_next");
    expect(
      readBlockNoteRevisionFence(
        { documentId: null, revisionKey: null },
        { documentId: "brainPage:br_01:pg_overview", revisionKey: null },
      ),
    ).toBeNull();
  });

  it("advances the same-document local fence after a successful save", () => {
    expect(
      readBlockNoteRevisionFence(
        { documentId: "brainPage:br_01:pg_overview", revisionKey: "rev_start" },
        {
          documentId: "brainPage:br_01:pg_overview",
          revisionKey: "rev_after_remote_save",
        },
        "rev_after_local_save",
      ),
    ).toBe("rev_after_local_save");
  });
});
