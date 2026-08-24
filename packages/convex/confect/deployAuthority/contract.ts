import { DataModel } from "@confect/server";
import type { GenericMutationCtx } from "convex/server";
import databaseSchema from "../_generated/schema";

export type DeployAuthorityAction = "preflight" | "convex" | "cloudflare";
export const DEPLOY_AUTHORITY_ISSUER_ID =
  "maestro-promotion-authority-v1" as const;
export type DeployAuthorityScope = {
  readonly environment: "staging" | "production";
  readonly targetId: string;
  readonly commitSha: string;
  readonly action: DeployAuthorityAction;
};
export type DeployAuthorityPayload = DeployAuthorityScope & {
  readonly schemaVersion: 1;
  readonly kind: "durable-deploy-authorization";
  readonly issuerId: string;
  readonly verdictHash: string;
  readonly approvalHash: string;
  readonly censusFingerprint: string;
  readonly consumptionId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
};
export type AuthorityContext = GenericMutationCtx<
  DataModel.ToConvex<DataModel.FromSchema<typeof databaseSchema>>
>;
export type StoreDependencies = {
  readonly nowMs: () => number;
  readonly authorityMode: "authority" | undefined;
  readonly expectedIssuerPublicKeyHash: string;
  readonly runtimeSigningKeyProofSignature: string;
};
export const runtimeSigningKeyProofPayload = {
  schemaVersion: 1,
  kind: "deploy-authority-runtime-signing-key-proof",
  issuerId: DEPLOY_AUTHORITY_ISSUER_ID,
} as const;
