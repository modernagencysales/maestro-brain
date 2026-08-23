import { editorSyncAccessDenied } from "./errors";

export type EditorTarget = { readonly kind: "brainPage"; readonly id: string };

export const parseEditorTarget = (documentId: string): EditorTarget => {
  const [kind, ...rest] = documentId.split(":");
  const id = rest.join(":");
  if (kind === "brainPage" && id.length > 0) {
    return { kind, id };
  }
  throw editorSyncAccessDenied(
    "unsupported-target",
    `Unsupported editor document target: ${documentId}`,
  );
};
