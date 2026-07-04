import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  MemberNotInWorkspace,
  Unauthorized,
  WorkspaceNotFound,
} from "../confect/errors";
import {
  WorkspaceReadErrors,
  WorkspaceWriteErrors,
  workspaceErrorTags,
} from "../confect/capabilities/_kit/errors";

describe("capability kit public errors", () => {
  it("encodes workspace read errors as public tagged values", () => {
    expect(Schema.encodeSync(WorkspaceReadErrors)(new Unauthorized())).toEqual({
      _tag: "Unauthorized",
    });
    expect(
      Schema.encodeSync(WorkspaceReadErrors)(
        new MemberNotInWorkspace({ membershipId: "workspaceMembers_missing" }),
      ),
    ).toEqual({
      _tag: "MemberNotInWorkspace",
      membershipId: "workspaceMembers_missing",
    });
  });

  it("keeps the writable family a superset of read errors", () => {
    expect(
      Schema.encodeSync(WorkspaceWriteErrors)(
        new WorkspaceNotFound({ workspaceId: "workspaces_missing" }),
      ),
    ).toEqual({
      _tag: "WorkspaceNotFound",
      workspaceId: "workspaces_missing",
    });
    expect(workspaceErrorTags).toContain("ValidationFailed");
  });
});
