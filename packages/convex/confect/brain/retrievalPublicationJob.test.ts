import { describe, expect, it } from "vitest";

import {
  retrievalPublicationJobKey,
  retrievalPublicationJobRow,
} from "./retrievalPublicationJob";

const input = {
  organizationKey: "ag_apero",
  workspaceId: "workspace_apero",
  brainKey: "brain_apero",
  originKind: "page" as const,
  sourceKey: "page_company",
  sourceRevisionKey: "revision_1",
  requestGeneration: 2,
  page: {
    authority: "derived" as const,
    authorityPolicyKey: "company-pages",
    policyGeneration: 2,
  },
};

describe("retrieval publication jobs", () => {
  it("keys the exact origin, target, and generation deterministically", () => {
    expect(retrievalPublicationJobKey(input)).toBe(
      retrievalPublicationJobKey({ ...input }),
    );
    expect(
      retrievalPublicationJobKey({ ...input, requestGeneration: 3 }),
    ).not.toBe(retrievalPublicationJobKey(input));
  });

  it("starts as a visible retryable pending job", () => {
    expect(retrievalPublicationJobRow(input, 1_000)).toMatchObject({
      jobKey: expect.stringMatching(/^rjob_[a-f0-9]{64}$/),
      status: "pending",
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAt: 1_000,
    });
  });
});
