# Self-Service Agency Onboarding Design

## Decision

A successful public signup with no WorkOS organization memberships creates one
isolated WorkOS organization and one Agency Brain workspace. The first user is
the Brain workspace owner. A user session without an active organization is an
onboarding condition, not an authorization defect, and never renders the generic
route error.

The app never adds a public signup to WRIP or another existing organization. It
never treats an unrelated WorkOS membership as proof that the user should own
the corresponding Brain tenant. Existing team-member invitation onboarding is a
separate flow and remains outside this fix.

## Outcome

A new agency owner can sign up and reach a usable Agency Brain without operator
intervention. Refreshing or retrying an interrupted setup resumes the same
agency. If setup cannot finish, the page gives the user working retry and
sign-out actions instead of `Route unavailable`.

## Scope Guard

Included:

- Detecting an authenticated WorkOS user whose session has no active
  organization.
- Creating one deterministic agency organization only when the user has no
  active WorkOS memberships.
- Resuming only the organization created for that same founding user.
- Creating the WorkOS membership and switching the session through AuthKit.
- Provisioning the Agency Brain and owner role through the existing Convex
  `ensureProvisionedFromWorkos` boundary.
- One recoverable setup-failure state and a server-side logout route.
- Idempotency, race handling, tenant isolation, accessibility, and hosted
  acceptance.

Excluded:

- Team-member invitation acceptance and cross-agency membership selection.
- Automatically choosing or provisioning an unrelated existing WorkOS
  membership.
- Billing, trials, plan selection, domains, SSO, and directory sync.
- Asking for an agency name during signup. The existing provisioner uses the
  verified display name; renaming is a later settings concern.
- Changing connector, transcript, Client Brain, or retrieval behavior.

Fabro remains paused. Woodpecker remains the required CI authority.

## Known Adjacent Gap

The existing Brain invitation acceptance path creates internal workspace
membership but does not yet reconcile a first-time invitee's WorkOS membership
with owner-oriented Convex provisioning. This design does not conceal that gap
by promoting invitees or creating personal agencies for them. Such sessions fail
closed with the agency-access message above. Team-member onboarding needs its
own follow-up design and acceptance test.

## Minimal Architecture

Reuse the installed and existing boundaries:

- `@workos-inc/node` for organization and membership reads/writes. Add it as a
  direct web dependency because AuthKit currently provides it only transitively.
- WorkOS `externalId` plus `createOrganization`'s native `idempotencyKey` for
  deterministic organization creation.
- AuthKit `switchToOrganization` to refresh the session cookie and access token
  with the new organization claim.
- Existing Convex `ensureProvisionedFromWorkos` for stable Brain organization,
  Agency Brain, organization owner, and workspace owner creation.
- Existing route-pending UI while the server loader performs setup.

Add one small server-only onboarding service. Do not add a generic workflow, job
queue, retry framework, provider abstraction, or client-side state machine.

## Signup And Session Flow

1. WorkOS authenticates the user.
2. Require the server-derived WorkOS user ID, email, and verified-email flag. An
   incomplete or unverified identity stops before any organization write.
3. If the session already has an active organization, run the existing Convex
   provisioning path unchanged.
4. If the organization claim is absent, list the authenticated user's active
   WorkOS memberships and look up the onboarding-owned organization by the
   deterministic external ID `maestro-brain-founder:{workosUserId}`.
5. If that organization exists and the user is its active member, call AuthKit
   `switchToOrganization` and resume. This is the interrupted-setup path.
6. If the user has no active memberships, create or recover that deterministic
   organization, using the verified display name with `Agency` appended (or the
   email local-part as a fallback), create its membership, and switch the
   session to it.
7. If any active membership exists but none is the deterministic
   onboarding-owned organization, stop safely. Do not create another agency,
   choose an organization, or grant Brain ownership.
8. Use the access token returned by `switchToOrganization` to call the existing
   Convex `ensureProvisionedFromWorkos` action in the same server request.
9. Return the authenticated runtime and continue to the originally requested
   safe local path. No extra success redirect is required.

The WorkOS API key, user ID, membership list, organization ID, session cookie,
and access token remain server-side. The browser submits none of them as
onboarding authority.

## Idempotency And Concurrency

Organization creation uses both:

- external ID `maestro-brain-founder:{workosUserId}`; and
- a stable WorkOS idempotency key derived from the same versioned value.

The server reads before creating. If create returns a duplicate conflict, it
reads by external ID and continues only when that organization has the expected
external ID. Membership creation reads active memberships first; a concurrent
create or reactivation is resolved by re-reading the authoritative membership.

The existing Convex provisioner already derives stable keys, selects a single
live owner-controlled organization and Agency Brain, creates owner memberships,
and rejects duplicate WorkOS-organization bindings. The onboarding layer does
not duplicate that logic.

## Runtime And UI States

Keep the runtime contract small:

- `signedOut`: redirect to sign in.
- `authenticated`: an active organization claim exists and provisioning
  succeeds.
- `setupFailure`: onboarding stopped safely and can retry or sign out.

The existing route-pending component covers server work in progress. A separate
`onboarding`, `organizationSelectionRequired`, or client-side workflow state is
not needed for this owner-signup fix.

Root rendering handles `setupFailure` before AuthKit, workspace, Convex-query,
or application-shell providers mount. This prevents organization-dependent hooks
from throwing while authority is incomplete.

## Product Copy

Default recoverable failure:

- Heading: `Agency setup couldn't finish`
- Body:
  `Your account is ready, but your private workspace isn't. Retry setup or sign out and try again.`
- Primary action: `Retry setup`
- Secondary action: `Sign out`

Existing unrelated membership:

- Heading: `Agency access needs attention`
- Body:
  `This account already belongs to an agency, but Brain can't open it from this session. Sign out, then use that agency's invitation link.`
- Action: `Sign out`

Errors remain calm and actionable. Raw provider errors, identifiers, tokens, and
stack traces are never shown.

## Accessibility

- Render the setup failure inside a visible primary `main` landmark with one
  page-level heading.
- Move focus to the heading when the failure route renders.
- Announce the failure through a stable `role="alert"` region.
- Use a native button for `Retry setup` and a normal link to `/logout` for
  `Sign out`.
- While retry is submitting, disable only that button, preserve its label, and
  expose progress text through a polite status region.
- Preserve visible focus indicators, logical keyboard order, 200% zoom, and
  320-pixel reflow.

## Error Handling

- Do not add automatic retry machinery. A failed server request returns the
  typed setup state; the explicit retry action is safe because creation is
  idempotent.
- Treat organization or membership duplicate conflicts as races: re-read and
  verify before continuing.
- Treat forbidden, inactive, or unrelated membership states as non-retryable for
  owner onboarding.
- Never call Convex provisioning until the refreshed access token contains the
  organization selected by AuthKit.
- Preserve a requested path only when it is a safe local application path;
  otherwise continue to `/brain`.
- Provide `/logout` through AuthKit's server `signOut` operation so a stale
  organization-less cookie can always be cleared.

## Security And Isolation

- Zero active memberships is required before creating a new self-service agency,
  except when resuming the deterministic organization owned by the same founding
  user.
- Public signup never joins an existing organization by email domain, name,
  operator default, or membership count.
- Organization switching accepts only the deterministic onboarding-owned
  organization in this flow.
- Every Convex write remains fenced by the organization claim in the refreshed
  access token.
- Logs record a correlation tag and typed outcome, not email addresses, WorkOS
  response bodies, cookies, access tokens, or API keys.
- Failed setup creates no cross-tenant access. Orphaned WorkOS resources may be
  resumed by the same user only; they are never reassigned.

## Testing

Focused behavior tests cover:

- Signed-out redirect and existing organization passthrough.
- Zero memberships creating one organization and membership.
- Interrupted setup recovering the deterministic organization.
- Stable WorkOS idempotency key and duplicate-conflict re-read.
- An unrelated membership refusing owner provisioning.
- AuthKit session switch completing before Convex provisioning.
- WorkOS create, membership, switch, and Convex failures producing the safe
  setup state.
- Retry success and logout from an organization-less session.
- Safe return-path validation.
- Cross-user external-ID and cross-organization negative cases.
- Keyboard traversal, focus placement, accessible names, live announcements,
  200% zoom, and narrow-width reflow for the failure surface.

Hosted acceptance creates a disposable WorkOS user with a generated password and
no memberships, signs in through the real hosted UI, reaches Agency Brain, hard
reloads, verifies the owner role, and confirms another agency cannot read the
workspace. The test deletes its WorkOS membership, organization, and user in
`finally`. It runs as a release smoke, not on every PR. Brain staging records
are marked with a stable acceptance prefix and remain until a supported Brain
purge path exists; the test does not pretend physical cleanup exists.

## Staging Migration

Before hosted acceptance, remove only the manually created WRIP membership for
`timkeen+test@gmail.com` after verifying no internal Brain authorization depends
on it. That membership was an operator workaround, not a valid tenant binding,
and would correctly fail the new unrelated-membership guard. Do not change the
smoke account or any pre-existing membership. After deployment, the same user
can resume its organization-less session and create its own isolated agency.

## Success Criteria

- A zero-membership signup reaches a usable Agency Brain without operator
  intervention.
- Refreshing or retrying creates no duplicate WorkOS organization, membership,
  Brain organization, or Agency Brain.
- No organization-less session renders `Route unavailable`.
- A stale session can always sign out and restart setup.
- Existing memberships never cause automatic owner promotion or access to WRIP
  or another customer tenant.
- Required focused tests, full repository verification, Woodpecker, and hosted
  fresh-signup acceptance pass on the release head.
