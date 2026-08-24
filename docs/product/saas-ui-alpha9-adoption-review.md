# Saas UI alpha.9 post-generation adoption review

Review decision: adopted.

This is a reviewed post-generation adoption record. It does not claim or
fabricate a pre-generation authority packet. The generated target had already
become non-empty before that packet was retained, so this review re-establishes
the frontend authority from immutable pins, receipts, route hashes, runtime
acceptance, and paired visual evidence.

## Authority

- Product repository: `modernagencysales/maestro-brain`
- Canonical branch: `main`
- Generated release: `maestro-template-v0.2.0-alpha.9`
- Release source commit: `a7988397b74eb56a2ad8ec0cffb19b98107f303a`
- Starter repository: `saas-js/tanstack-start-starter-kit-pro`
- Starter commit: `b76cb4514b9ab47f7db87901cb9b593b4adc3129`
- Saas UI Pro commit: `ac3a40c8dc05e403f9d501a87c092646891d3c40`
- Frontend deviation ledger: `docs/template/saas-ui-deviations.json`, exact
  empty array

The pinned Starter route tree and Saas UI Pro registry remain the frontend
authority. Product behavior enters through typed adapters; it does not replace
upstream layout, spacing, component choice, or interaction composition.

## Whole-screen adoption

| Brain surface | Whole upstream authority                                     | Product seam                                    |
| ------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Connections   | Saas UI Pro `IntegrationCard` story composition              | Durable `providerConnections` lifecycle adapter |
| Brain         | Complete Starter Inbox list/detail layout                    | Revision-fenced Brain page adapter              |
| Clients       | Complete Starter Contacts list and detail screens            | Authorized workspace/client adapter             |
| Shell         | Complete Starter `_app` route hierarchy and responsive shell | Product navigation labels and route adapters    |

No legacy `_workspace`, business-shell, golden-feature, or custom navigation
alternative is approved. The old Nango/Slack branches target a retired schema
and are not adoption authority.

## Mechanical proof

- `docs/template/saas-ui-starter-files.json` records every Starter source and
  destination hash, including explicit adapted seams.
- `docs/template/saas-ui-registry-files.json` and
  `docs/template/saas-ui-vendor-receipt.json` bind the installed Pro sources to
  their immutable pin.
- `pnpm check:saas-ui-foundation` verifies the literal route tree, screen
  provenance, receipt hashes, and empty deviation ledger.
- `pnpm acceptance:required` exercises all nine required product behaviors,
  including Brain isolation/detail, revision fencing, cited Ask parity,
  connection lifecycle, and authorized client switching.
- `pnpm maestro -- verify --scope full` and the Woodpecker delivery pipeline are
  the exact-head release gates; `.maestro/verification-receipt.json` is their
  repository receipt.

## Paired visual and accessibility review

The retained packet is under `artifacts/saas-ui-alpha9-review/`. It contains the
same complete Contacts screen from the pinned Starter and generated Brain in:

- desktop light and dark at 1440 by 1000;
- mobile light and dark at 390 by 844; and
- raw upstream captures showing the exact pinned runtime before review-only
  overlay removal.

The pin has an upstream loader defect: its root loader remains opaque after the
screen hydrates and it emits a React state-update warning. Raw screenshots
retain that fact. For composition review only, the packet also hides that
overlay after the complete Contacts screen and `Add person` control are present.
The generated target's already-receipted Provider adapter clears the loader
normally and the generated captures have no browser errors.

At a 320 px viewport, both reviewed screens reported a 320 px document width
with no document-level horizontal overflow. Keyboard-only tab traversal reached
workspace, search, user, navigation, filter, display, and action controls. The
generated target produced no page or console errors during this pass.

Approved: pinned reference and generated target preserve the Starter authority
and receipt.

## Ongoing rule

Future UI work must first select a complete pinned Pro demo screen, assembled
Pro block/template, or Starter screen. Only when none applies may it compose
loose primitives, and any such gap requires a reviewed template-promotion path.
Product logic stays behind the existing adapters so an agent cannot silently
hand-roll another shell.
