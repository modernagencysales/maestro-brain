import {
  approvalPayload,
  type ApprovalInput,
  type AuthorityAdminCode,
  type CensusInput,
  type DeployAuthorityOperator,
  provisionApproval,
  provisionCensus,
  provisionVerdict,
  readRuntimeSigningIssuer,
  type VerdictInput,
  verdictPayload,
} from "./admin";
import { ConvexError } from "convex/values";
import {
  canonical,
  DEPLOY_AUTHORITY_ISSUER_ID,
  runtimeSigningKeyProofPayload,
  sha256,
  type AuthorityContext,
  validateAndHashSnapshot,
  verifyIssuerSignature,
} from "./store";

export type DeploymentEvidenceInput = {
  readonly environment: "staging" | "production";
  readonly targetId: string;
  readonly commitSha: string;
  readonly capturedAt: number;
  readonly pageCount: number;
  readonly totalCount: number;
  readonly nextCursor: string | null;
  readonly runsJson: string;
  readonly immutableBindingsJson: string;
  readonly sourceReceiptHash: string;
  readonly ttlMs: number;
};

export type DeploymentEvidenceResult =
  | {
      readonly kind: "ok";
      readonly approvalHash: string;
      readonly censusSnapshotId: string;
      readonly verdictHash: string;
      readonly expiresAt: number;
    }
  | { readonly kind: "blocked"; readonly code: AuthorityAdminCode };

type IssuanceRequest = {
  readonly context: AuthorityContext;
  readonly operator: DeployAuthorityOperator;
  readonly input: DeploymentEvidenceInput;
  readonly runtime: {
    readonly now: number;
    readonly privateKeyPkcs8Base64Url: string | undefined;
  };
};

type RuntimeSigner = {
  readonly proofSignature: string;
  readonly sign: (payload: unknown) => Promise<string>;
};

type SigningIssuer = NonNullable<
  Awaited<ReturnType<typeof readRuntimeSigningIssuer>>
>;

type Evidence = {
  readonly approval: ApprovalInput;
  readonly census: CensusInput;
  readonly verdict: VerdictInput;
  readonly expiresAt: number;
};

const shaPattern = /^sha256:[0-9a-f]{64}$/;
const targetPattern = /^[a-z][a-z0-9-]{0,62}$/;
const commitPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_EVIDENCE_TTL_MS = 10 * 60_000;

export const issueDeploymentEvidence = async (
  request: IssuanceRequest,
): Promise<DeploymentEvidenceResult> => {
  if (!validRequest(request.input, request.runtime)) {
    return blocked("invalid-input");
  }
  const prepared = await prepareEvidence(request);
  if (prepared.kind === "blocked") return prepared;
  const conflict = await findConflict(
    request.context,
    prepared.evidence,
    request.runtime.now,
  );
  if (conflict !== undefined) return blocked(conflict);

  await provisionEvidence({
    context: request.context,
    operator: request.operator,
    evidence: prepared.evidence,
    now: request.runtime.now,
  });
  return {
    kind: "ok",
    approvalHash: prepared.evidence.approval.approvalHash,
    censusSnapshotId: prepared.evidence.census.snapshotId,
    verdictHash: prepared.evidence.verdict.verdictHash,
    expiresAt: prepared.evidence.expiresAt,
  };
};

const prepareEvidence = async (
  request: IssuanceRequest,
): Promise<
  | { readonly kind: "ok"; readonly evidence: Evidence }
  | { readonly kind: "blocked"; readonly code: AuthorityAdminCode }
> => {
  const signer = await prepareRuntimeSigner(
    request.runtime.privateKeyPkcs8Base64Url,
  );
  if (signer === undefined) return blocked("invalid-input");
  const issuer = await resolveSigningIssuer({
    context: request.context,
    operator: request.operator,
    signer,
    now: request.runtime.now,
  });
  if (issuer.kind === "blocked") return issuer;
  const evidence = await buildEvidence({
    input: request.input,
    operator: request.operator,
    issuer: issuer.value,
    signer,
    now: request.runtime.now,
  });
  if (evidence === undefined) return blocked("invalid-input");
  return (await signaturesAreValid(evidence, issuer.value))
    ? { kind: "ok", evidence }
    : blocked("signature-invalid");
};

const validRequest = (
  input: DeploymentEvidenceInput,
  runtime: IssuanceRequest["runtime"],
): boolean =>
  validScope(input) &&
  validWindow(input, runtime) &&
  validCensusPayload(input) &&
  shaPattern.test(input.sourceReceiptHash);

const validScope = (input: DeploymentEvidenceInput): boolean =>
  (input.environment === "staging" || input.environment === "production") &&
  targetPattern.test(input.targetId) &&
  commitPattern.test(input.commitSha);

const validWindow = (
  input: DeploymentEvidenceInput,
  runtime: IssuanceRequest["runtime"],
): boolean => {
  const expiresAt = runtime.now + input.ttlMs;
  return [
    validTime(runtime.now) &&
      validTime(input.capturedAt) &&
      input.capturedAt <= runtime.now,
    Number.isSafeInteger(input.ttlMs) &&
      input.ttlMs >= 1_000 &&
      input.ttlMs <= MAX_EVIDENCE_TTL_MS,
    validTime(expiresAt) && expiresAt - input.capturedAt <= MAX_EVIDENCE_TTL_MS,
  ].every(Boolean);
};

const validCensusPayload = (input: DeploymentEvidenceInput): boolean =>
  input.runsJson.length <= 750_000 &&
  input.immutableBindingsJson.length <= 750_000;

const resolveSigningIssuer = async (input: {
  readonly context: AuthorityContext;
  readonly operator: DeployAuthorityOperator;
  readonly signer: RuntimeSigner;
  readonly now: number;
}): Promise<
  | { readonly kind: "ok"; readonly value: SigningIssuer }
  | { readonly kind: "blocked"; readonly code: AuthorityAdminCode }
> => {
  const issuer = await readRuntimeSigningIssuer(input.context, input.now);
  if (issuer === null) return blocked("issuer-unavailable");
  if (issuer.authorityOrigin !== input.operator.authorityOrigin) {
    return blocked("mixed-origin");
  }
  const validProof = await verifyIssuerSignature(
    issuer.publicKeySpki,
    canonical(runtimeSigningKeyProofPayload),
    input.signer.proofSignature,
  );
  return validProof
    ? { kind: "ok", value: issuer }
    : blocked("signature-invalid");
};

const buildEvidence = async (input: {
  readonly input: DeploymentEvidenceInput;
  readonly operator: DeployAuthorityOperator;
  readonly issuer: SigningIssuer;
  readonly signer: RuntimeSigner;
  readonly now: number;
}): Promise<Evidence | undefined> => {
  const expiresAt = input.now + input.input.ttlMs;
  const censusBase = {
    environment: input.input.environment,
    targetId: input.input.targetId,
    commitSha: input.input.commitSha,
    capturedAt: input.input.capturedAt,
    expiresAt,
    pageCount: input.input.pageCount,
    totalCount: input.input.totalCount,
    nextCursor: input.input.nextCursor,
    runsJson: input.input.runsJson,
    immutableBindingsJson: input.input.immutableBindingsJson,
    sourceReceiptHash: input.input.sourceReceiptHash,
  } as const;
  const censusSnapshotId = await validateAndHashSnapshot(censusBase);
  if (censusSnapshotId === undefined) return undefined;
  const census: CensusInput = { ...censusBase, snapshotId: censusSnapshotId };
  const approval = await buildApproval({ ...input, expiresAt });
  const verdict = await buildVerdict({
    ...input,
    expiresAt,
    approvalHash: approval.approvalHash,
    censusSnapshotId,
  });
  return { approval, census, verdict, expiresAt };
};

const buildApproval = async (input: {
  readonly input: DeploymentEvidenceInput;
  readonly operator: DeployAuthorityOperator;
  readonly issuer: SigningIssuer;
  readonly signer: RuntimeSigner;
  readonly now: number;
  readonly expiresAt: number;
}): Promise<ApprovalInput> => {
  const base = {
    environment: input.input.environment,
    targetId: input.input.targetId,
    commitSha: input.input.commitSha,
    issuerId: DEPLOY_AUTHORITY_ISSUER_ID,
    issuerPublicKeyHash: input.issuer.publicKeyHash,
    issuedAt: input.now,
    expiresAt: input.expiresAt,
    sourceReceiptHash: input.input.sourceReceiptHash,
  } as const;
  const unsigned = approvalPayload(
    { ...base, approvalHash: "", signature: "" },
    input.operator.authorityOrigin,
  );
  const approvalHash = await sha256(canonical(unsigned));
  return {
    ...base,
    approvalHash,
    signature: await input.signer.sign({ ...unsigned, approvalHash }),
  };
};

const buildVerdict = async (input: {
  readonly input: DeploymentEvidenceInput;
  readonly operator: DeployAuthorityOperator;
  readonly issuer: SigningIssuer;
  readonly signer: RuntimeSigner;
  readonly now: number;
  readonly expiresAt: number;
  readonly approvalHash: string;
  readonly censusSnapshotId: string;
}): Promise<VerdictInput> => {
  const base = {
    environment: input.input.environment,
    targetId: input.input.targetId,
    commitSha: input.input.commitSha,
    issuerId: DEPLOY_AUTHORITY_ISSUER_ID,
    issuerPublicKeyHash: input.issuer.publicKeyHash,
    approvalHash: input.approvalHash,
    censusSnapshotId: input.censusSnapshotId,
    issuedAt: input.now,
    expiresAt: input.expiresAt,
    sourceReceiptHash: input.input.sourceReceiptHash,
  } as const;
  const unsigned = verdictPayload(
    { ...base, verdictHash: "", signature: "" },
    input.operator.authorityOrigin,
    input.censusSnapshotId,
  );
  const verdictHash = await sha256(canonical(unsigned));
  return {
    ...base,
    verdictHash,
    signature: await input.signer.sign({ ...unsigned, verdictHash }),
  };
};

const signaturesAreValid = async (
  evidence: Evidence,
  issuer: SigningIssuer,
): Promise<boolean> => {
  const approval = approvalPayload(evidence.approval, issuer.authorityOrigin);
  const verdict = verdictPayload(
    evidence.verdict,
    issuer.authorityOrigin,
    evidence.census.snapshotId,
  );
  return (
    (await verifyIssuerSignature(
      issuer.publicKeySpki,
      canonical({ ...approval, approvalHash: evidence.approval.approvalHash }),
      evidence.approval.signature,
    )) &&
    (await verifyIssuerSignature(
      issuer.publicKeySpki,
      canonical({ ...verdict, verdictHash: evidence.verdict.verdictHash }),
      evidence.verdict.signature,
    ))
  );
};

const findConflict = async (
  context: AuthorityContext,
  evidence: Evidence,
  now: number,
): Promise<"duplicate-record" | "scope-conflict" | undefined> => {
  const scope = evidence.approval;
  const [
    approvalDuplicates,
    liveApprovals,
    censusDuplicates,
    verdictDuplicates,
    liveVerdicts,
  ] = await Promise.all([
    context.db
      .query("deployApprovals")
      .withIndex("by_approval_hash", (query) =>
        query.eq("approvalHash", evidence.approval.approvalHash),
      )
      .take(2),
    context.db
      .query("deployApprovals")
      .withIndex("by_scope_and_expires_at", (query) =>
        query
          .eq("environment", scope.environment)
          .eq("targetId", scope.targetId)
          .eq("commitSha", scope.commitSha)
          .gt("expiresAt", now),
      )
      .take(2),
    context.db
      .query("deployCensusSnapshots")
      .withIndex("by_snapshot", (query) =>
        query.eq("snapshotId", evidence.census.snapshotId),
      )
      .take(2),
    context.db
      .query("deployVerdicts")
      .withIndex("by_verdict_hash", (query) =>
        query.eq("verdictHash", evidence.verdict.verdictHash),
      )
      .take(2),
    context.db
      .query("deployVerdicts")
      .withIndex("by_scope_approval_and_expires_at", (query) =>
        query
          .eq("environment", scope.environment)
          .eq("targetId", scope.targetId)
          .eq("commitSha", scope.commitSha)
          .eq("approvalHash", evidence.approval.approvalHash)
          .gt("expiresAt", now),
      )
      .take(2),
  ]);
  if (
    approvalDuplicates.length > 0 ||
    censusDuplicates.length > 0 ||
    verdictDuplicates.length > 0
  ) {
    return "duplicate-record";
  }
  return liveApprovals.length > 0 || liveVerdicts.length > 0
    ? "scope-conflict"
    : undefined;
};

const provisionEvidence = async (input: {
  readonly context: AuthorityContext;
  readonly operator: DeployAuthorityOperator;
  readonly evidence: Evidence;
  readonly now: number;
}): Promise<void> => {
  const approval = await provisionApproval(
    input.context,
    input.operator,
    input.evidence.approval,
    input.now,
  );
  assertProvisioned(approval, input.evidence.approval.approvalHash, "approval");
  const census = await provisionCensus(
    input.context,
    input.operator,
    input.evidence.census,
    input.now,
  );
  assertProvisioned(census, input.evidence.census.snapshotId, "census");
  const verdict = await provisionVerdict(
    input.context,
    input.operator,
    input.evidence.verdict,
    input.now,
  );
  assertProvisioned(verdict, input.evidence.verdict.verdictHash, "verdict");
};

const assertProvisioned = (
  result: Awaited<ReturnType<typeof provisionApproval>>,
  expectedHash: string,
  phase: "approval" | "census" | "verdict",
): void => {
  if (result.kind !== "ok" || result.resourceHash !== expectedHash) {
    throw new ConvexError({
      kind: "deployment-evidence-provisioning-invariant",
      phase,
      code: result.kind === "blocked" ? result.code : "hash-mismatch",
    });
  }
};

const prepareRuntimeSigner = async (
  privateKeyPkcs8Base64Url: string | undefined,
): Promise<RuntimeSigner | undefined> => {
  if (!privateKeyPkcs8Base64Url) return undefined;
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      decodeBase64Url(privateKeyPkcs8Base64Url),
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    return {
      proofSignature: await signPayload(runtimeSigningKeyProofPayload, key),
      sign: (payload) => signPayload(payload, key),
    };
  } catch {
    return undefined;
  }
};

const signPayload = async (
  payload: unknown,
  key: CryptoKey,
): Promise<string> => {
  const signature = await crypto.subtle.sign(
    "Ed25519",
    key,
    new TextEncoder().encode(canonical(payload)),
  );
  return encodeBase64Url(new Uint8Array(signature));
};

const validTime = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const blocked = (code: AuthorityAdminCode) =>
  ({ kind: "blocked", code }) as const;

const decodeBase64Url = (value: string): ArrayBuffer => {
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  );
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
};

const encodeBase64Url = (value: Uint8Array): string =>
  btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
