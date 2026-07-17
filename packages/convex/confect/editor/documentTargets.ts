import { editorSyncAccessDenied } from "./errors";

export type EditorTarget =
  | {
      readonly kind: "brainPage";
      readonly brainKey: string;
      readonly pageKey: string;
      readonly legacyPageId: null;
    }
  | {
      readonly kind: "brainPage";
      readonly brainKey: null;
      readonly pageKey: null;
      readonly legacyPageId: string;
    };

export const parseEditorTarget = (documentId: string): EditorTarget => {
  const [kind, ...rest] = documentId.split(":");
  if (kind === "brainPage" && rest.length === 2) {
    const brainKey = rest[0];
    const pageKey = rest[1];
    if (
      brainKey !== undefined &&
      pageKey !== undefined &&
      brainKey.length > 0 &&
      pageKey.length > 0
    ) {
      return { kind, brainKey, pageKey, legacyPageId: null };
    }
  }

  const legacyPageId = rest.join(":");
  if (kind === "brainPage" && rest.length === 1 && legacyPageId.length > 0) {
    return { kind, brainKey: null, pageKey: null, legacyPageId };
  }

  throw editorSyncAccessDenied(
    "unsupported-target",
    `Unsupported editor document target: ${documentId}`,
  );
};
