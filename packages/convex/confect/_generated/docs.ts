import type { Document } from "@confect/server";
import type schemaDefinition from "./schema";

export type BrainPagesDoc = Document.Document<typeof schemaDefinition, "brainPages">;
export type WorkspacesDoc = Document.Document<typeof schemaDefinition, "workspaces">;

export interface Docs {
  brainPages: BrainPagesDoc;
  workspaces: WorkspacesDoc;
}
