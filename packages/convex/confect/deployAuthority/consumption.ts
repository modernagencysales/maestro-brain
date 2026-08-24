import { validateAndHashSnapshot } from "./census";
import {
  type AuthorityContext,
  DEPLOY_AUTHORITY_ISSUER_ID,
  type DeployAuthorityPayload,
  type DeployAuthorityScope,
  runtimeSigningKeyProofPayload,
  type StoreDependencies,
} from "./contract";
import { canonical, sha256, verifyIssuerSignature } from "./crypto";

type ConsumptionResult =
  | { readonly kind: "authorized"; readonly payload: DeployAuthorityPayload }
  | { readonly kind: "denied" | "replayed" };
type LoadedEvidence = Extract<
  Awaited<ReturnType<typeof loadEvidence>>,
  { readonly kind: "ok" }
>;
type IssuerRow = {
  readonly issuerId: string;
  readonly publicKeyHash: string;
  readonly publicKeySpki: string;
  readonly authorityOrigin?: string;
};
type VerifiedIssuer = IssuerRow & { readonly authorityOrigin: string };
type SnapshotRow = Record<string, unknown> & {
  readonly snapshotId: string;
  readonly environment: string;
  readonly targetId: string;
  readonly commitSha: string;
  readonly authorityOrigin?: string;
  readonly capturedAt: number;
  readonly expiresAt: number;
};
type VerifiedEvidence = {
  readonly issuer: VerifiedIssuer;
  readonly snapshot: SnapshotRow;
  readonly censusFingerprint: string;
};
type ConsumptionSession = {
  readonly context: AuthorityContext;
  readonly scope: DeployAuthorityScope;
  readonly dependencies: StoreDependencies;
  readonly loaded: LoadedEvidence;
  readonly now: number;
};

export const consumeDeployAuthority = async (
  context: AuthorityContext,
  scope: DeployAuthorityScope,
  dependencies: StoreDependencies,
): Promise<ConsumptionResult> => {
  if (dependencies.authorityMode !== "authority") return denied();
  const now = dependencies.nowMs();
  const loaded = await loadEvidence(context, scope, now);
  return loaded.kind === "ok"
    ? consumeLoadedEvidence({ context, scope, dependencies, loaded, now })
    : loaded;
};

const loadEvidence = async (
  context: AuthorityContext,
  scope: DeployAuthorityScope,
  now: number,
) => {
  const approvals = await context.db
    .query("deployApprovals")
    .withIndex("by_scope_and_expires_at", (query) =>
      query
        .eq("environment", scope.environment)
        .eq("targetId", scope.targetId)
        .eq("commitSha", scope.commitSha)
        .gt("expiresAt", now),
    )
    .take(2);
  const approval = exactlyOne(approvals);
  if (approval === undefined) return denied();
  const [verdicts, consumptions] = await Promise.all([
    context.db
      .query("deployVerdicts")
      .withIndex("by_scope_approval_and_expires_at", (query) =>
        query
          .eq("environment", scope.environment)
          .eq("targetId", scope.targetId)
          .eq("commitSha", scope.commitSha)
          .eq("approvalHash", approval.approvalHash)
          .gt("expiresAt", now),
      )
      .take(2),
    context.db
      .query("deployActionConsumptions")
      .withIndex("by_scope_action_approval", (query) =>
        query
          .eq("environment", scope.environment)
          .eq("targetId", scope.targetId)
          .eq("commitSha", scope.commitSha)
          .eq("action", scope.action)
          .eq("approvalHash", approval.approvalHash),
      )
      .take(2),
  ]);
  if (consumptions.length > 0) return { kind: "replayed" } as const;
  const verdict = exactlyOne(verdicts);
  return verdict === undefined
    ? denied()
    : ({ kind: "ok", approval, verdict } as const);
};

const consumeLoadedEvidence = async (
  session: ConsumptionSession,
): Promise<ConsumptionResult> => {
  if (!validEvidencePair(session.loaded, session.now)) return denied();
  const verified = await verifyEvidence(session);
  return verified === undefined
    ? denied()
    : commitConsumption({ ...session, verified });
};

const validEvidencePair = (loaded: LoadedEvidence, now: number): boolean => {
  const { approval, verdict } = loaded;
  return [
    approval.expiresAt > now && verdict.expiresAt > now,
    approval.issuedAt !== undefined &&
      approval.issuedAt <= now &&
      verdict.issuedAt !== undefined &&
      verdict.issuedAt <= now,
    approval.issuerId === verdict.issuerId &&
      approval.issuerId === DEPLOY_AUTHORITY_ISSUER_ID &&
      approval.approvalHash === verdict.approvalHash,
    approval.issuerPublicKeyHash !== undefined &&
      approval.issuerPublicKeyHash === verdict.issuerPublicKeyHash,
    approval.authorityOrigin !== undefined &&
      approval.authorityOrigin === verdict.authorityOrigin,
  ].every(Boolean);
};

const verifyEvidence = async (
  session: ConsumptionSession,
): Promise<VerifiedEvidence | undefined> => {
  const issuer = await resolveIssuer(
    session.context,
    session.loaded,
    session.dependencies,
    session.now,
  );
  if (issuer === undefined) return undefined;
  if (!(await verifyApproval(session.scope, session.loaded, issuer))) {
    return undefined;
  }
  const census = await resolveCensus(
    session.context,
    session.scope,
    session.loaded,
    session.now,
  );
  if (census === undefined) return undefined;
  return (await verifyVerdict(
    session.scope,
    session.loaded,
    issuer,
    census.fingerprint,
  ))
    ? {
        issuer,
        snapshot: census.snapshot,
        censusFingerprint: census.fingerprint,
      }
    : undefined;
};

const resolveIssuer = async (
  context: AuthorityContext,
  loaded: LoadedEvidence,
  dependencies: StoreDependencies,
  now: number,
): Promise<VerifiedIssuer | undefined> => {
  const rows = await context.db
    .query("deployAuthorityIssuers")
    .withIndex("by_issuer", (query) =>
      query.eq("issuerId", loaded.approval.issuerId),
    )
    .take(101);
  if (rows.length > 100) return undefined;
  const latest = Math.max(-1, ...rows.map((row) => row.provisionedAt ?? -1));
  const active = rows.filter((row) => isActiveIssuer(row, latest, now));
  const issuer = exactlyOne(active);
  if (issuer === undefined) return undefined;
  if (!(await validIssuer(issuer, loaded, dependencies))) return undefined;
  return { ...issuer, authorityOrigin: String(issuer.authorityOrigin) };
};

const isActiveIssuer = (
  row: {
    readonly provisionedAt?: number;
    readonly enabled: boolean;
    readonly retiredAt?: number | null;
    readonly activatedAt?: number;
  },
  latest: number,
  now: number,
): boolean =>
  [
    row.provisionedAt === latest && row.enabled,
    row.retiredAt === null,
    row.activatedAt !== undefined && row.activatedAt <= now,
  ].every(Boolean);

const validIssuer = async (
  issuer: IssuerRow,
  loaded: LoadedEvidence,
  dependencies: StoreDependencies,
): Promise<boolean> =>
  [
    issuer.authorityOrigin !== undefined &&
      issuer.authorityOrigin === loaded.approval.authorityOrigin,
    issuer.publicKeyHash === loaded.approval.issuerPublicKeyHash &&
      issuer.publicKeyHash === dependencies.expectedIssuerPublicKeyHash,
    issuer.publicKeyHash === (await sha256(issuer.publicKeySpki)),
    await verifyIssuerSignature(
      issuer.publicKeySpki,
      canonical(runtimeSigningKeyProofPayload),
      dependencies.runtimeSigningKeyProofSignature,
    ),
  ].every(Boolean);

const verifyApproval = async (
  scope: DeployAuthorityScope,
  loaded: LoadedEvidence,
  issuer: IssuerRow,
): Promise<boolean> => {
  const payload = signedPayload({
    kind: "deploy-approval",
    scope,
    issuerId: loaded.approval.issuerId,
    issuerPublicKeyHash: loaded.approval.issuerPublicKeyHash,
    authorityOrigin: loaded.approval.authorityOrigin,
    issuedAt: loaded.approval.issuedAt,
    expiresAt: loaded.approval.expiresAt,
    evidence: {},
  });
  return (
    loaded.approval.approvalHash === (await sha256(canonical(payload))) &&
    (await verifyIssuerSignature(
      issuer.publicKeySpki,
      canonical({ ...payload, approvalHash: loaded.approval.approvalHash }),
      loaded.approval.signature,
    ))
  );
};

const resolveCensus = async (
  context: AuthorityContext,
  scope: DeployAuthorityScope,
  loaded: LoadedEvidence,
  now: number,
): Promise<
  { readonly snapshot: SnapshotRow; readonly fingerprint: string } | undefined
> => {
  const snapshots = await context.db
    .query("deployCensusSnapshots")
    .withIndex("by_snapshot", (query) =>
      query.eq("snapshotId", loaded.verdict.censusSnapshotId),
    )
    .take(2);
  const snapshot = exactlyOne(snapshots);
  if (snapshot === undefined || !validSnapshot(snapshot, scope, loaded, now)) {
    return undefined;
  }
  const fingerprint = await validateAndHashSnapshot(snapshot);
  return fingerprint === snapshot.snapshotId
    ? { snapshot, fingerprint }
    : undefined;
};

const validSnapshot = (
  snapshot: SnapshotRow,
  scope: DeployAuthorityScope,
  loaded: LoadedEvidence,
  now: number,
): boolean =>
  [
    snapshot.environment === scope.environment &&
      snapshot.targetId === scope.targetId &&
      snapshot.commitSha === scope.commitSha,
    snapshot.authorityOrigin !== undefined &&
      snapshot.authorityOrigin === loaded.approval.authorityOrigin,
    snapshot.expiresAt > now && snapshot.capturedAt <= now,
  ].every(Boolean);

const verifyVerdict = async (
  scope: DeployAuthorityScope,
  loaded: LoadedEvidence,
  issuer: IssuerRow,
  censusFingerprint: string,
): Promise<boolean> => {
  const payload = signedPayload({
    kind: "deploy-verdict",
    scope,
    issuerId: loaded.verdict.issuerId,
    issuerPublicKeyHash: loaded.verdict.issuerPublicKeyHash,
    authorityOrigin: loaded.verdict.authorityOrigin,
    issuedAt: loaded.verdict.issuedAt,
    expiresAt: loaded.verdict.expiresAt,
    evidence: {
      approvalHash: loaded.verdict.approvalHash,
      censusFingerprint,
    },
  });
  return (
    loaded.verdict.verdictHash === (await sha256(canonical(payload))) &&
    (await verifyIssuerSignature(
      issuer.publicKeySpki,
      canonical({ ...payload, verdictHash: loaded.verdict.verdictHash }),
      loaded.verdict.signature,
    ))
  );
};

const signedPayload = (input: {
  readonly kind: "deploy-approval" | "deploy-verdict";
  readonly scope: DeployAuthorityScope;
  readonly issuerId: string;
  readonly issuerPublicKeyHash: string | undefined;
  readonly authorityOrigin: string | undefined;
  readonly issuedAt: number | undefined;
  readonly expiresAt: number;
  readonly evidence: Readonly<Record<string, string>>;
}) => ({
  schemaVersion: 1,
  kind: input.kind,
  environment: input.scope.environment,
  targetId: input.scope.targetId,
  commitSha: input.scope.commitSha,
  issuerId: input.issuerId,
  issuerPublicKeyHash: input.issuerPublicKeyHash,
  authorityOrigin: input.authorityOrigin,
  ...input.evidence,
  issuedAt: input.issuedAt,
  expiresAt: input.expiresAt,
});

const commitConsumption = async (
  input: ConsumptionSession & { readonly verified: VerifiedEvidence },
): Promise<ConsumptionResult> => {
  const consumptionId = (
    await sha256(
      canonical({
        ...input.scope,
        approvalHash: input.loaded.approval.approvalHash,
        consumedAt: input.now,
      }),
    )
  ).slice("sha256:".length);
  await input.context.db.insert("deployActionConsumptions", {
    ...input.scope,
    approvalHash: input.loaded.approval.approvalHash,
    verdictHash: input.loaded.verdict.verdictHash,
    authorityOrigin: input.verified.issuer.authorityOrigin,
    consumptionId,
    consumedAt: input.now,
  });
  return {
    kind: "authorized",
    payload: {
      schemaVersion: 1,
      kind: "durable-deploy-authorization",
      ...input.scope,
      issuerId: input.verified.issuer.issuerId,
      verdictHash: input.loaded.verdict.verdictHash,
      approvalHash: input.loaded.approval.approvalHash,
      censusFingerprint: input.verified.censusFingerprint,
      consumptionId,
      issuedAt: input.now,
      expiresAt: Math.min(
        input.now + 60_000,
        input.loaded.approval.expiresAt,
        input.loaded.verdict.expiresAt,
        input.verified.snapshot.expiresAt,
      ),
    },
  };
};

const exactlyOne = <Value>(values: readonly Value[]): Value | undefined =>
  values.length === 1 ? values[0] : undefined;
const denied = () => ({ kind: "denied" }) as const;
