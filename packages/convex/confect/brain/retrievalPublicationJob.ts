import { sha256Hex } from "../shared/sha256";

export type RetrievalPublicationJobInput = {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly originKind: "page" | "slack" | "transcript";
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly requestGeneration: number;
  readonly page?: {
    readonly authority: "authoritative" | "derived" | "advisory";
    readonly authorityPolicyKey: string;
    readonly policyGeneration: number;
  };
};

export const retrievalPublicationJobKey = (
  input: RetrievalPublicationJobInput,
) =>
  `rjob_${sha256Hex(
    JSON.stringify({
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      originKind: input.originKind,
      sourceKey: input.sourceKey,
      sourceRevisionKey: input.sourceRevisionKey,
      requestGeneration: input.requestGeneration,
      page: input.page ?? null,
    }),
  )}`;

export const retrievalPublicationJobRow = (
  input: RetrievalPublicationJobInput,
  now: number,
) => ({
  schemaVersion: 1 as const,
  organizationKey: input.organizationKey,
  workspaceId: input.workspaceId,
  brainKey: input.brainKey,
  jobKey: retrievalPublicationJobKey(input),
  originKind: input.originKind,
  sourceKey: input.sourceKey,
  sourceRevisionKey: input.sourceRevisionKey,
  requestGeneration: input.requestGeneration,
  ...(input.page === undefined ? {} : { page: input.page }),
  status: "pending" as const,
  attemptCount: 0,
  maxAttempts: 5,
  nextAttemptAt: now,
  createdAt: now,
  updatedAt: now,
});
