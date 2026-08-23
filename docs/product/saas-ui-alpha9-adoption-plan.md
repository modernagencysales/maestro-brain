---
planSchemaVersion: 1
productContract: product.contract.yaml
workPackages:
  - id: WP-BRAIN-001
    behaviorIds:
      - BHV-BRAIN-001
    appMapTargets:
      - route:$workspace/inbox
      - route:$workspace/inbox/$id
      - system:knowledge-brain
      - table:brainPages
    work:
      kind: fixture-to-real
      target: apps/web/src/features/contacts/inbox/brain-inbox-adapter.ts
      persistenceOrProviderBoundary:
        Keep the database-backed brain.pages Confect contract and restore the
        standalone Brain page tree, history, and authorization behavior behind
        generated refs.
      followUpGates:
        - pnpm --dir apps/web test -- brain-inbox-adapter
        - pnpm --dir apps/web typecheck
        - pnpm check:saas-ui-foundation
      frontend:
        screenCatalogId: starter-route:apps/web/src/routes/_app/$workspace/_dashboard/inbox.tsx
        sourceReceipt: docs/template/saas-ui-starter-files.json
        shellId: app-shell
        allowedAdaptations:
          - route-binding
          - auth-adapter
          - data-adapter
          - mutation-adapter
          - product-label-icon
          - compatibility-seam
        requiredVisualStates:
          - loading
          - empty
          - error
          - populated
          - selected
          - mutation
  - id: WP-BRAIN-002
    behaviorIds:
      - BHV-BRAIN-002
    appMapTargets:
      - route:$workspace/inbox/$id
      - system:knowledge-brain
      - table:brainPages
    work:
      kind: fixture-to-real
      target: apps/web/src/features/contacts/inbox/brain-inbox-view-page.tsx
      persistenceOrProviderBoundary:
        Preserve the source Brain immutable page revisions, typed stale-write
        failure, audit trail, and shared headless reads; adapt those contracts
        into the complete Starter contact-detail composition.
      followUpGates:
        - pnpm --dir apps/web test -- brain-page-editor-state
        - pnpm --dir packages/convex test:contract
        - pnpm acceptance:required
      frontend:
        screenCatalogId: starter-route:apps/web/src/routes/_app/$workspace/_dashboard/inbox/$id.tsx
        sourceReceipt: docs/template/saas-ui-starter-files.json
        shellId: app-shell
        allowedAdaptations:
          - route-binding
          - auth-adapter
          - data-adapter
          - mutation-adapter
          - product-label-icon
          - compatibility-seam
        requiredVisualStates:
          - loading
          - empty
          - error
          - populated
          - selected
          - mutation
  - id: WP-BRAIN-003
    behaviorIds:
      - BHV-BRAIN-003
    appMapTargets:
      - route:$workspace/search
      - agent:assistant
      - capability:source-grounded-brief
      - system:knowledge-brain
    work:
      kind: fixture-to-real
      target: apps/web/src/features/search/ask-maestro-adapter.ts
      persistenceOrProviderBoundary:
        Replace the assistant contract fixture with the existing standalone
        Brain read API and ContextPack v3 path while retaining server-derived
        identity, citation eligibility, freshness, and typed failures.
      followUpGates:
        - pnpm --dir apps/web test -- ask-maestro-adapter
        - pnpm --dir packages/convex test:contract
        - pnpm check:headless-surface-contract
      frontend:
        screenCatalogId: starter-route:apps/web/src/routes/_app/$workspace/_dashboard/search.tsx
        sourceReceipt: docs/template/saas-ui-starter-files.json
        shellId: app-shell
        allowedAdaptations:
          - route-binding
          - auth-adapter
          - data-adapter
          - mutation-adapter
          - product-label-icon
          - compatibility-seam
        requiredVisualStates:
          - loading
          - empty
          - error
          - populated
          - selected
          - mutation
  - id: WP-BRAIN-004
    behaviorIds:
      - BHV-BRAIN-004
    appMapTargets:
      - route:$workspace/settings
      - system:provider-integrations
    work:
      kind: fixture-to-real
      target: apps/web/src/features/connections/connections-adapter.ts
      persistenceOrProviderBoundary:
        Replace the alpha.9 connection fixture with the existing standalone
        Brain provider connection, lifecycle generation, and scoped OAuth
        contracts without moving provider SDKs into the web application.
      followUpGates:
        - pnpm --dir apps/web test -- connections-adapter
        - pnpm check:provider-boundary
        - pnpm check:env-boundary
      frontend:
        screenCatalogId: pro-story:packages/blocks/settings/integration-card/integration-card.stories.tsx
        sourceReceipt: docs/template/saas-ui-registry-files.json
        shellId: app-shell
        allowedAdaptations:
          - route-binding
          - auth-adapter
          - data-adapter
          - mutation-adapter
          - product-label-icon
          - compatibility-seam
        requiredVisualStates:
          - loading
          - empty
          - error
          - populated
          - selected
          - mutation
  - id: WP-BRAIN-005
    behaviorIds:
      - BHV-BRAIN-005
    appMapTargets:
      - route:$workspace/contacts/
      - route:$workspace/contacts/view/$id
      - system:access-and-tenancy
      - table:workspaces
    work:
      kind: fixture-to-real
      target: apps/web/src/features/contacts/clients-adapter.ts
      persistenceOrProviderBoundary:
        Preserve WorkOS organization membership and the standalone Brain
        agency/client workspace authorization model behind the complete Starter
        Contacts list and detail screens.
      followUpGates:
        - pnpm --dir apps/web test -- clients-adapter
        - pnpm check:auth-demo-bypass
        - pnpm check:access-audit-events
      frontend:
        screenCatalogId: starter-route:apps/web/src/routes/_app/$workspace/_dashboard/contacts/index.tsx
        sourceReceipt: docs/template/saas-ui-starter-files.json
        shellId: app-shell
        allowedAdaptations:
          - route-binding
          - auth-adapter
          - data-adapter
          - mutation-adapter
          - product-label-icon
          - compatibility-seam
        requiredVisualStates:
          - loading
          - empty
          - error
          - populated
          - selected
          - mutation
proofs:
  - behavior: BHV-BRAIN-001
    behaviorRevision: 1
    level: black-box
    surfaces: [web-ui]
    observation:
      The literal Starter Inbox route lists only the active workspace Brain
      pages and opens the selected page inside its complete detail composition.
    failureWitness:
      The route shows template contacts, another workspace's pages, a bespoke
      Brain shell, or cannot open the selected page.
  - behavior: BHV-BRAIN-002
    behaviorRevision: 1
    level: black-box
    surfaces: [web-ui, cli-process, public-http]
    observation:
      A revision-fenced web edit is returned by CLI and HTTP reads, while a
      stale update is rejected without changing the saved revision.
    failureWitness:
      Any surface returns different markdown, the stale write succeeds, or the
      current revision changes after the rejected write.
  - behavior: BHV-BRAIN-003
    behaviorRevision: 1
    level: black-box
    surfaces: [web-ui, cli-process, public-http]
    observation:
      The same question exposes the same eligible evidence revisions, working
      citations, and freshness through Search, CLI, and HTTP.
    failureWitness:
      A surface uses fixture text, omits citations, cites ineligible evidence,
      or disagrees about the evidence revision.
  - behavior: BHV-BRAIN-004
    behaviorRevision: 1
    level: black-box
    surfaces: [web-ui]
    observation:
      Connecting and revoking a source updates the complete IntegrationCard
      composition from the durable provider lifecycle generation.
    failureWitness:
      The card reports only local component state, stores credentials in the
      browser, or diverges from the provider connection contract.
  - behavior: BHV-BRAIN-005
    behaviorRevision: 1
    level: black-box
    surfaces: [web-ui]
    observation:
      Starter Contacts lists only authorized client workspaces and switches the
      active workspace boundary before a selected client's Brain is read.
    failureWitness:
      An unauthorized client appears or a selected client continues reading or
      writing against the agency workspace.
---

# Alpha.9 Whole-Screen Adoption

The immutable alpha.9 Starter route tree and Saas UI Pro compositions are the
visible authority. The standalone Brain backend at `origin/main` is behavior
authority. Product behavior enters the purchased screens only through the thin
adapters named in frontmatter.

## Adoption Matrix

| Product job              | Whole composition retained                                     | Product seam                                           | Do not restore                                                            |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| App shell and navigation | Starter `_app/$workspace/_dashboard.tsx` and `DashboardLayout` | `product-shell.ts` labels and literal route bindings   | `_workspace`, `TemplateWorkspaceShell`, business-shell, custom navigation |
| Browse Brain pages       | Starter Inbox list route                                       | `brain-inbox-adapter.ts`                               | old Brain tree/list JSX                                                   |
| Read and edit one page   | Starter Inbox detail route plus contact-detail composition     | generated page refs and revision-fenced editor adapter | old Brain workspace/editor shell                                          |
| Ask Maestro              | complete Starter Search screen                                 | ContextPack and grounded-assistant adapter             | bespoke chat/search page                                                  |
| Manage sources           | installed Pro `IntegrationCard` story composition              | durable connection lifecycle adapter                   | old integrations screen and browser-owned provider state                  |
| Browse clients           | Starter Contacts list and detail screens                       | organization/workspace adapter                         | old clients screen                                                        |
| Authentication           | complete Starter auth routes                                   | WorkOS auth adapter                                    | old sign-in and callback UI                                               |
| Onboarding               | complete Starter getting-started routes                        | organization/workspace provisioning adapter            | old onboarding route UI                                                   |
| Settings                 | complete Starter nested settings routes                        | account, membership, billing, and API-key adapters     | old monolithic settings screen                                            |

`docs/template/saas-ui-deviations.json` remains the exact empty array. A missing
product affordance first changes an adapter or maps to another complete catalog
composition; it does not authorize route-local replacement JSX.

## Execution Order

1. Freeze alpha.9 shell and route parity; do not change upstream composition.
2. Restore the source Brain Confect contracts, durable tables, headless
   operations, and generated refs by product namespace, keeping alpha.9 workflow
   and customer-target infrastructure.
3. Complete WP-BRAIN-001 and WP-BRAIN-002 before Ask so page identity,
   revisions, and citations have one stable base.
4. Complete ContextPack/Ask parity, then connections and client tenancy.
5. Preserve complete auth, onboarding, settings, and shell compositions while
   attaching the remaining source adapters.
6. Run exact-head full verification, deploy, and complete connected-browser
   desktop/mobile/light/dark acceptance against the pinned reference.
7. Cut the launcher only after repository identity, template instance, release
   commit, route tree, and screen provenance all match the deployed head.

## Branch And Checkout Cleanup

Cleanup is part of delivery, but it is deliberately last:

1. Refresh the read-only branch/worktree inventory and record exact heads,
   upstreams, dirty state, and launcher references.
2. Create and push recovery tags for every stale branch that contains unique or
   dirty work; verify each tag resolves to the recorded commit.
3. Preserve the exact deployment receipt and connected-browser acceptance packet
   for the canonical head.
4. Update launcher authority to the standalone `maestro-brain` repository,
   alpha.9 `template-instance.json`, literal Starter route tree, and proven
   canonical branch.
5. Delete only the reviewed exact local and remote branch names. Never use a
   wildcard, and never delete a dirty worktree as branch cleanup.
6. Rerun the inventory and prove that no launcher, worktree, CI default, or
   documentation points at a deleted or quarantined branch.

The adoption authority packet was not captured before this generated target
became non-empty. We will not fabricate that pre-generation fact. This target
can ship only with an explicit reviewed post-generation adoption record, or it
must be rebuilt through a newly preflighted empty target if strict authority
chain continuity is required.
