import type { HeadlessOperationPolicy } from "./headless/authorizeOperation";

export type TemplateHttpRoute = {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly description: string;
};

export type RateLimitAdmissionMetadata = {
  readonly operationId: string;
  readonly pathname: string;
  readonly method: string;
  readonly hasAuthorization: boolean;
  readonly contentType: string | null;
  readonly userAgentFamily: "absent" | "present";
  readonly networkBucket: "direct" | "untrusted-forwarded";
};

export type HeadlessHttpCtx = {
  readonly runQuery: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runMutation: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runAction: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly authenticateRef?: unknown;
  readonly markLastUsedRef?: unknown;
  readonly operationRefs?: Record<string, unknown>;
  readonly operationPolicies?: Record<string, HeadlessOperationPolicy>;
  readonly rateLimit?: (
    input: RateLimitAdmissionMetadata,
  ) => boolean | Promise<boolean>;
};
