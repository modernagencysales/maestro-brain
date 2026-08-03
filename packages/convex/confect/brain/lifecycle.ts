export type BrainLifecycleState =
  "active" | "revoked" | "expired" | "redacted" | "purged";

export type BrainLifecycle = {
  readonly state: BrainLifecycleState;
  readonly generation: number;
  readonly updatedAt?: number;
  readonly expiresAt?: number | null;
};

export class LifecycleRevoked extends Error {
  override readonly name = "LifecycleRevoked";

  constructor() {
    super("LifecycleRevoked");
  }
}

export class LifecycleExpired extends Error {
  override readonly name = "LifecycleExpired";

  constructor() {
    super("LifecycleExpired");
  }
}

export const assertReadableLifecycle = (
  lifecycle: Pick<BrainLifecycle, "state" | "generation" | "expiresAt">,
  now: number,
): void => {
  if (lifecycle.state !== "active") {
    if (lifecycle.state === "expired") throw new LifecycleExpired();
    throw new LifecycleRevoked();
  }
  if (
    lifecycle.expiresAt !== undefined &&
    lifecycle.expiresAt !== null &&
    lifecycle.expiresAt <= now
  ) {
    throw new LifecycleExpired();
  }
};

export const revokeLifecycle = (
  lifecycle: Pick<BrainLifecycle, "state" | "generation">,
  now: number,
): BrainLifecycle =>
  lifecycle.state === "revoked"
    ? { ...lifecycle, updatedAt: now }
    : {
        state: "revoked",
        generation: lifecycle.generation + 1,
        updatedAt: now,
      };

export type RetentionDisposition = {
  readonly action: "retain" | "purge" | "blocked";
  readonly executable: false;
  readonly reason: "retention_not_due" | "retention_due" | "legal_hold";
};

export const buildRetentionDisposition = (input: {
  readonly resource: string;
  readonly purgeAfter: number | null | undefined;
  readonly now: number;
  readonly legalHold: boolean;
}): RetentionDisposition =>
  input.legalHold
    ? { action: "blocked", executable: false, reason: "legal_hold" }
    : input.purgeAfter !== undefined &&
        input.purgeAfter !== null &&
        input.purgeAfter <= input.now
      ? { action: "purge", executable: false, reason: "retention_due" }
      : { action: "retain", executable: false, reason: "retention_not_due" };

export const buildDsarDisposition = (input: {
  readonly kind: "export" | "delete";
  readonly confirmationMatches: boolean;
  readonly legalHold: boolean;
}): {
  readonly action: "ready" | "needs_confirmation" | "blocked";
  readonly executable: false;
  readonly reason: "ready" | "confirmation" | "legal_hold";
} =>
  input.legalHold
    ? { action: "blocked", executable: false, reason: "legal_hold" }
    : input.kind === "delete" && !input.confirmationMatches
      ? {
          action: "needs_confirmation",
          executable: false,
          reason: "confirmation",
        }
      : { action: "ready", executable: false, reason: "ready" };
