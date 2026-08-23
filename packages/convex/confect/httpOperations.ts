import { Ref } from "@confect/core";
import { ConvexError } from "convex/values";
import { api, internal } from "../convex/_generated/api";
import feedbackSpec from "./brain/feedback.spec";
import noteStatusSpec from "./brain/noteStatus.spec";
import pilotSpec from "./brain/pilot.spec";
import {
  reviewedHeadlessPolicyFor,
  type HeadlessOperationPolicy,
} from "./headless/authorizeOperation";
import apiKeysSpec from "./headless/apiKeys.spec";
import type { HeadlessPrincipal } from "./headless/principal";
import { runHeadlessNoteSubmit } from "./headlessNoteHttp";
import {
  authenticateBearerRequest,
  authenticatedExecutorRequestFor,
  authorizeOperationBeforeDecode,
  bearerKeyHashForRequest,
  readJsonBody,
  type TemplateApiRequestBody,
} from "./httpRequest";
import { jsonResponse } from "./httpResponses";
import type { HeadlessHttpCtx, RateLimitAdmissionMetadata } from "./httpTypes";
import {
  executeHeadlessOperation,
  type HeadlessExecutorRequest,
} from "./manifest/executor";
import { validateCallerIdempotencyKey } from "./shared/idempotencyKey";

const feedbackOperationId = "brain.feedback.reportWrongOrStale";
const noteSubmitOperationId = "brain.notes.submit";
const noteStatusOperationId = "brain.notes.status";
const noteListOperationId = "brain.notes.list";

const requiredSpecReference = (
  path: string,
  spec: unknown,
  code: string,
  message: string,
): unknown => {
  if (spec === undefined) throw new ConvexError({ code, message });
  return Ref.getFunctionReference(Ref.make(path, spec as never));
};

const operationRefs = {
  "brain.pages.list": api.brain.pages.list,
  "brain.pages.get": api.brain.pages.get,
  "brain.pages.history": api.brain.pages.history,
  "brain.sources.search": internal.brain.readApi.headlessSourcesSearch,
  "brain.sources.get": internal.brain.readApi.headlessSourcesGet,
  "brain.context.get": internal.brain.readApi.headlessContextGet,
  "brain.answers.ask": internal.brain.readApi.headlessAnswersAsk,
  "brain.rollout.status": internal.brain.readApi.headlessBrainRolloutStatus,
  [feedbackOperationId]: requiredSpecReference(
    "brain/feedback",
    feedbackSpec.functions.headlessReportWrongOrStale,
    "HEADLESS_FEEDBACK_SPEC_MISSING",
    "Missing feedback.headlessReportWrongOrStale spec",
  ),
  [noteSubmitOperationId]: requiredSpecReference(
    "brain/pilot",
    pilotSpec.functions.headlessSubmitNote,
    "HEADLESS_NOTE_SPEC_MISSING",
    "Missing pilot.headlessSubmitNote spec",
  ),
  [noteStatusOperationId]: requiredSpecReference(
    "brain/noteStatus",
    noteStatusSpec.functions.get,
    "HEADLESS_NOTE_STATUS_SPEC_MISSING",
    "Missing noteStatus.get spec",
  ),
  [noteListOperationId]: requiredSpecReference(
    "brain/noteStatus",
    noteStatusSpec.functions.list,
    "HEADLESS_NOTE_LIST_SPEC_MISSING",
    "Missing noteStatus.list spec",
  ),
} satisfies Record<string, unknown>;

const apiKeyReference = (name: "authenticate" | "markLastUsed"): unknown =>
  requiredSpecReference(
    "headless/apiKeys",
    apiKeysSpec.functions[name],
    "HEADLESS_API_KEY_SPEC_MISSING",
    `Missing apiKeys.${name} spec`,
  );

const apiKeyRefs = {
  authenticate: apiKeyReference("authenticate"),
  markLastUsed: apiKeyReference("markLastUsed"),
} as const;

const invalidIdempotencyResponse = (message: string) => ({
  ok: false,
  error: { _tag: "ValidationFailed", message },
});

type OperationHandler = (
  ctx: HeadlessHttpCtx,
  request: HeadlessExecutorRequest,
) => Promise<unknown>;

const refsFor = (ctx: HeadlessHttpCtx): Record<string, unknown> =>
  ctx.operationRefs ?? operationRefs;

const feedbackHandler: OperationHandler = async (ctx, request) => {
  const idempotencyKey = validateCallerIdempotencyKey(request.idempotencyKey);
  if (!idempotencyKey.ok)
    return invalidIdempotencyResponse(idempotencyKey.error.message);
  const result = await ctx.runMutation(refsFor(ctx)[feedbackOperationId], {
    ...request.input,
    idempotencyKey: idempotencyKey.value,
  });
  return { ok: true, operationId: feedbackOperationId, result };
};

const noteSubmitHandler: OperationHandler = async (ctx, request) =>
  await runHeadlessNoteSubmit(
    (ref, input) => ctx.runMutation(ref, input),
    refsFor(ctx)[noteSubmitOperationId],
    request,
  );

const queryHandler =
  (operationId: string): OperationHandler =>
  async (ctx, request) => {
    const result = await ctx.runQuery(refsFor(ctx)[operationId], request.input);
    return { ok: true, operationId, result };
  };

const operationHandlers: Readonly<
  Record<string, OperationHandler | undefined>
> = {
  [feedbackOperationId]: feedbackHandler,
  [noteSubmitOperationId]: noteSubmitHandler,
  [noteStatusOperationId]: queryHandler(noteStatusOperationId),
  [noteListOperationId]: queryHandler(noteListOperationId),
};

const genericOperationHandler: OperationHandler = async (ctx, request) =>
  await executeHeadlessOperation(
    {
      refs: refsFor(ctx),
      runQuery: (ref, input) => ctx.runQuery(ref, input),
      runMutation: (ref, input) => ctx.runMutation(ref, input),
      runAction: (ref, input) => ctx.runAction(ref, input),
    },
    request,
  );

const runTemplateApiOperation = async (
  ctx: HeadlessHttpCtx,
  request: HeadlessExecutorRequest,
): Promise<unknown> =>
  await (operationHandlers[request.operationId] ?? genericOperationHandler)(
    ctx,
    request,
  );

const canonicalContentType = (value: string | null): string | null =>
  value?.split(";", 1)[0]?.trim().toLowerCase() || null;

const rateLimitAdmissionMetadataFor = (
  request: Request,
  operationId: string,
): RateLimitAdmissionMetadata => {
  const headers = request.headers;
  return {
    operationId,
    pathname: new URL(request.url).pathname,
    method: request.method,
    hasAuthorization: headers.has("authorization"),
    contentType: canonicalContentType(headers.get("content-type")),
    userAgentFamily: headers.has("user-agent") ? "present" : "absent",
    networkBucket: headers.has("x-forwarded-for")
      ? "untrusted-forwarded"
      : "direct",
  };
};

type Authenticated = {
  readonly principal: HeadlessPrincipal;
  readonly keyHash: string;
  readonly keyId?: string;
};

type Admission =
  | {
      readonly ok: true;
      readonly policy: HeadlessOperationPolicy;
      readonly authenticated: Authenticated;
      readonly authenticate: (hash: string) => Promise<unknown>;
    }
  | { readonly ok: false; readonly response: Response };

const deniedResponse = (): Response =>
  jsonResponse({
    ok: false,
    error: { _tag: "Forbidden", message: "Forbidden." },
  });

const initialAdmission = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: string,
): Promise<Admission> => {
  const policy =
    ctx.operationPolicies?.[operationId] ??
    reviewedHeadlessPolicyFor(operationId);
  if (policy === undefined) return { ok: false, response: deniedResponse() };

  const limited = await ctx.rateLimit?.(
    rateLimitAdmissionMetadataFor(request, operationId),
  );
  if (limited === true)
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: { _tag: "RateLimited", message: "Rate limited." },
      }),
    };

  const keyHash = await bearerKeyHashForRequest(
    request.headers.get("authorization") ?? undefined,
  );
  if (!keyHash.ok) return { ok: false, response: jsonResponse(keyHash) };

  const authenticate = (hash: string): Promise<unknown> =>
    ctx.runQuery(ctx.authenticateRef ?? apiKeyRefs.authenticate, {
      keyHash: hash,
      requiredScope: policy.requiredScope,
    });
  const authenticated = await authenticateBearerRequest({
    keyHash: keyHash.keyHash,
    runAuthenticate: authenticate,
  });
  return authenticated.ok
    ? { ok: true, policy, authenticated, authenticate }
    : { ok: false, response: jsonResponse(authenticated) };
};

const responseForParsedTemplateApiBody = async (input: {
  readonly ctx: HeadlessHttpCtx;
  readonly operationId: string;
  readonly principal: HeadlessPrincipal;
  readonly body: TemplateApiRequestBody;
  readonly policy: HeadlessOperationPolicy;
}): Promise<unknown> => {
  const executorRequest = await authenticatedExecutorRequestFor(input);
  return executorRequest.ok
    ? await runTemplateApiOperation(input.ctx, executorRequest.request)
    : executorRequest;
};

const isHeadlessExecutionSuccess = (
  value: unknown,
): value is {
  readonly ok: true;
  readonly operationId: string;
  readonly result: unknown;
} =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  (value as { readonly ok?: unknown }).ok === true;

type Execution =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

const executeAuthorizedBody = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: string,
  admission: Extract<Admission, { readonly ok: true }>,
): Promise<Execution> => {
  const preauthorized = authorizeOperationBeforeDecode({
    operationId,
    principal: admission.authenticated.principal,
    policy: admission.policy,
  });
  if (!preauthorized.ok)
    return { ok: false, response: jsonResponse(preauthorized) };

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return { ok: false, response: jsonResponse(parsedBody) };

  const value = await responseForParsedTemplateApiBody({
    ctx,
    operationId,
    principal: admission.authenticated.principal,
    body: parsedBody.body,
    policy: admission.policy,
  }).catch(() => ({
    ok: false as const,
    error: { _tag: "Forbidden" as const, message: "Forbidden." },
  }));
  return isHeadlessExecutionSuccess(value)
    ? { ok: true, value }
    : { ok: false, response: jsonResponse(value) };
};

const sameAuthenticatedPrincipal = (
  initial: Authenticated,
  after: Authenticated,
): boolean => {
  const initialKeyId = initial.keyId ?? initial.principal.keyId;
  const afterKeyId = after.keyId ?? after.principal.keyId;
  const initialScopes = JSON.stringify([...initial.principal.scopes].sort());
  const afterScopes = JSON.stringify([...after.principal.scopes].sort());
  return [
    initial.keyHash === after.keyHash,
    initialKeyId === afterKeyId,
    initial.principal.organizationId === after.principal.organizationId,
    initial.principal.workspaceId === after.principal.workspaceId,
    initial.principal.brainKey === after.principal.brainKey,
    initial.principal.roleCeiling === after.principal.roleCeiling,
    initial.principal.keyId === after.principal.keyId,
    initial.principal.principalId === after.principal.principalId,
    initialScopes === afterScopes,
  ].every(Boolean);
};

const scheduleLastUsedBestEffort = async (
  ctx: HeadlessHttpCtx,
  authenticated: Authenticated,
): Promise<void> => {
  const principal = authenticated.principal;
  const args = {
    keyId: authenticated.keyId ?? principal.keyId,
    keyHash: authenticated.keyHash,
    principalId: principal.principalId,
    organizationId: principal.organizationId,
    workspaceId: principal.workspaceId,
    brainKey: principal.brainKey,
  };
  try {
    await ctx.runMutation(ctx.markLastUsedRef ?? apiKeyRefs.markLastUsed, args);
  } catch {
    // Best-effort last-used updates must not change the authorization result.
  }
};

const verifyContinuity = async (
  ctx: HeadlessHttpCtx,
  admission: Extract<Admission, { readonly ok: true }>,
): Promise<Execution> => {
  const after = await authenticateBearerRequest({
    keyHash: admission.authenticated.keyHash,
    runAuthenticate: admission.authenticate,
  });
  if (!after.ok) return { ok: false, response: jsonResponse(after) };
  if (!sameAuthenticatedPrincipal(admission.authenticated, after))
    return {
      ok: false,
      response: jsonResponse({
        ok: false,
        error: { _tag: "Unauthorized", message: "Unauthorized." },
      }),
    };
  await scheduleLastUsedBestEffort(ctx, after);
  return { ok: true, value: undefined };
};

export const executeTemplateApiRoute = async (
  ctx: HeadlessHttpCtx,
  request: Request,
  operationId: string,
): Promise<Response> => {
  const admission = await initialAdmission(ctx, request, operationId);
  if (!admission.ok) return admission.response;

  const execution = await executeAuthorizedBody(
    ctx,
    request,
    operationId,
    admission,
  );
  if (!execution.ok) return execution.response;

  const continuity = await verifyContinuity(ctx, admission);
  return continuity.ok ? jsonResponse(execution.value) : continuity.response;
};
