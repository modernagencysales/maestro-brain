import { useEffect, useRef } from "react";

import type { AgencySetupFailureReason } from "../../auth/authkit-server";

const copyByReason: Record<
  AgencySetupFailureReason,
  {
    readonly heading: string;
    readonly message: string;
    readonly retry: boolean;
  }
> = {
  provider_failure: {
    heading: "Agency setup couldn't finish",
    message:
      "Your account is safe. Check your connection and retry setup. If this keeps happening, sign out and try again.",
    retry: true,
  },
  identity_unverified: {
    heading: "Verify your email to finish setup",
    message:
      "Use the verification email from WorkOS, then return here and retry setup.",
    retry: true,
  },
  existing_membership: {
    heading: "This account already has organization access",
    message:
      "Agency Brain can't create a new agency while this account belongs to another organization. Sign out and use the account intended to own the new agency.",
    retry: false,
  },
};

export function AgencySetupFailure({
  reason,
}: {
  readonly reason: AgencySetupFailureReason;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const copy = copyByReason[reason];

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="template-route-state">
      <div className="template-route-state-panel">
        <p className="template-route-state-kicker">Agency Brain</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {copy.heading}
        </h1>
        <p role="alert">{copy.message}</p>
        <div className="template-route-state-actions">
          {copy.retry ? (
            <button
              data-variant="primary"
              onClick={() => window.location.reload()}
              type="button"
            >
              Retry setup
            </button>
          ) : null}
          <a data-variant={copy.retry ? "secondary" : "primary"} href="/logout">
            Sign out
          </a>
        </div>
      </div>
    </main>
  );
}
