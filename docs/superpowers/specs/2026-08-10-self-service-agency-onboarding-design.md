# Self-Service Agency Onboarding Design

## Decision

Every successful public signup creates or selects an isolated WorkOS
organization and provisions one Agency Brain workspace for that organization.
The first user becomes the Brain workspace owner. A user session without an
active organization is an onboarding state, not an authorization defect and
never a generic route error.

The app must not add public signups to the shared WRIP organization. Existing
invitations and organization memberships remain authoritative and take
precedence over creating a new agency.

## Outcome

A new agency owner can sign up, complete organization setup, and arrive at
Agency Brain without operator intervention. Retrying an interrupted signup is
idempotent. If setup cannot complete, the page explains what happened and offers
working retry and sign-out actions.

## Scope Guard

Included:

- Detecting an authenticated WorkOS user whose session has no organization.
- Reusing a sole existing active membership or creating a new agency
  organization for a user with no memberships.
- Creating the user's WorkOS membership and switching the session into that
  organization.
- Provisioning the corresponding Brain organization, Agency Brain, owner
  membership, and default workspace through the existing Convex boundary.
- A recoverable onboarding failure surface and a server-side logout route.
- Idempotency, race handling, tenant-isolation checks, and hosted acceptance.

Excluded:

- Billing, trials, plan selection, domains, SSO, and directory sync.
- Joining multiple agencies during signup.
- Automatically selecting between multiple existing memberships.
- Adding any public signup to WRIP or another existing customer organization.
- Changing connector, transcript, Client Brain, or retrieval behavior.

Fabro remains paused. Woodpecker remains the required CI authority.

## Signup And Session Flow

1. WorkOS authenticates the user.
2. The server reads the authenticated user and active organization claim.
3. If an organization claim exists, the current provisioning path continues.
4. If the claim is absent, the onboarding service lists only that user's active
   WorkOS memberships.
5. With one active membership, the server switches the session to it.
6. With no memberships, the server creates one organization using a stable
   external ID derived from the WorkOS user ID, creates the membership, and
   switches the session to the new organization.
7. With multiple memberships and no active selection, the server returns an
   explicit organization-selection state. It does not guess.
8. After the organization switch refreshes the session claims, the existing
   Convex `ensureProvisionedFromWorkos` action provisions the Agency Brain and
   grants the first internal member the owner role.
9. The browser returns to the originally requested safe application path.

Organization and membership creation are server-only WorkOS API operations. The
browser never receives the WorkOS API key. The session switch uses the official
AuthKit server operation so the refreshed cookie and access token contain the
selected organization.

## Idempotency And Concurrency

The WorkOS organization external ID is deterministic for the founding user.
Retries first look up the organization and current memberships, then create only
missing resources. A duplicate-creation conflict triggers a read and resume
instead of a second organization.

Convex provisioning keeps its existing organization-derived stable keys and
idempotent receipt. Concurrent browser requests may repeat reads and safe ensure
operations but cannot create a second Agency Brain or grant access to a
different tenant.

## Runtime States

The auth/runtime contract distinguishes:

- `signedOut`: redirect to sign in.
- `authenticated`: active organization claim exists; load the workspace.
- `onboarding`: organization setup or session switching is in progress.
- `organizationSelectionRequired`: multiple authorized memberships require an
  explicit choice.
- `onboardingFailure`: setup stopped with a safe typed reason and can retry.

An organization-less user is never converted to generic `Unauthorized`. Root
rendering handles onboarding states before mounting workspace queries, so
workspace hooks cannot throw while organization authority is incomplete.

## Product Copy

Pending state:

- Heading: `Setting up your agency`
- Body: `Creating your private Agency Brain workspace.`

Recoverable failure:

- Heading: `Agency setup needs attention`
- Body:
  `We couldn't finish creating your workspace. Retry setup or sign out and try another account.`
- Primary action: `Retry setup`
- Secondary action: `Sign out`

Multiple memberships:

- Heading: `Choose an agency`
- Body: `Select the agency you want to open.`
- Action per organization: `Open {organizationName}`

Errors remain calm and actionable. Raw provider errors, identifiers, tokens, and
stack traces are never shown.

## Error Handling

- Retry transient WorkOS failures with a short bounded policy and preserve the
  typed onboarding state when exhausted.
- Treat duplicate organization or membership creation as a recoverable race.
- Treat a forbidden or inactive membership as a non-retryable setup failure.
- Never call Convex provisioning until the refreshed access token contains the
  selected WorkOS organization.
- Preserve the requested application path only when it is a local safe path;
  otherwise return to `/brain`.
- Provide `/logout` through the official AuthKit server `signOut` operation so a
  stale organization-less cookie can always be cleared.

## Security And Isolation

- Public signup never joins an existing organization by email domain, name, or
  operator default.
- Existing membership reuse is allowed only when WorkOS says the authenticated
  user is an active member.
- Organization switching accepts only an organization from that membership list.
- WorkOS user ID and organization ID remain server-derived; the browser cannot
  submit either as onboarding authority.
- Every Convex write remains fenced by the organization claim in the refreshed
  access token.
- Logs record stable correlation tags and typed outcomes, not email addresses,
  cookies, access tokens, API keys, or WorkOS response bodies.

## Testing

Behavior tests cover:

- Signed-out redirect.
- Existing organization claim continuing without onboarding.
- No memberships creating one organization and membership exactly once.
- One existing membership switching without creating another organization.
- Multiple memberships requiring explicit selection.
- Duplicate-creation races resuming from the authoritative WorkOS state.
- Session switch completing before Convex provisioning.
- WorkOS and Convex transient failure, retry success, retry exhaustion, and
  non-retryable failure states.
- Safe return-path validation.
- Logout clearing a stale organization-less session.
- Cross-user and cross-organization negative cases.
- UI loading, selection, failure, retry, and sign-out states.

Hosted acceptance uses a disposable WorkOS user with no organization, verifies
that first login reaches Agency Brain, hard reloads the route, confirms the
workspace owner role, and proves another agency cannot read it. Cleanup removes
the disposable WorkOS and Brain test records through supported lifecycle paths.

## Success Criteria

- A new signup reaches a usable Agency Brain without operator intervention.
- Repeating or refreshing onboarding creates no duplicate WorkOS organization,
  membership, Brain organization, or Agency Brain.
- No organization-less session renders `Route unavailable`.
- A stale session can always sign out and restart setup.
- A public signup gains no access to WRIP or any existing customer tenant.
- Required focused tests, full repository verification, Woodpecker, and hosted
  fresh-signup acceptance pass on the release head.
