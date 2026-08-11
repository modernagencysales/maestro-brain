# Workspace Readiness Recovery Design

## Problem

The live workspace adapter currently throws
`Authorized workspace list is not ready.` for every query state except `ready`.
That incorrectly turns normal Convex authentication hydration into a visible
failure and also rejects the valid `empty` state that the workspace controller
uses to start provisioning. The resulting controller replacement can leave the
signed-in Brain route with an error flash or a blank transition.

## Approaches considered

1. Retry `loadWorkspaces` after a timeout. Rejected because time does not make
   an unauthorized query valid and timer ownership would outlive replaced
   controllers.
2. Treat loading as an empty workspace list. Rejected because it can provision
   before the authorization query has completed.
3. Gate controller creation until the query settles, then preserve `empty` as
   data and expose real failures. Selected because it follows the existing
   query-state model without retries or expanded authority.

## Design

The root workspace runtime boundary renders a branded, accessible loading state
while the generated workspace query is `loading` or `skipped`. It does not
construct or initialize a workspace controller during that period.

Once settled, the live adapter maps both `ready` and `empty` query data into the
stable workspace summary interface. An empty array therefore reaches the
existing controller flow: `load -> ensureProvisioned -> load -> ready`. Typed,
parse, transport, and defect query states become failures using their provider
message when available; the generic readiness message is removed.

No auth claims, WorkOS membership rules, Convex authorization, or provisioning
authority changes. The fix only corrects client state interpretation and the
visible loading boundary.

## Verification

- Unit tests prove pending-state classification, empty-list handling, and real
  failure propagation.
- A component test proves the loading state remains visible and accessible.
- Existing web tests and type checking protect controller and route behavior.
- Hosted acceptance signs in a disposable zero-membership user, observes no
  readiness error or blank body, reloads, and reaches the Brain plus API-key
  form.
