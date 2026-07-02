# Template Frontend Stack Source Audit

Date: 2026-07-01

Purpose: record exactly which Maestro frontend primitives should be ported into
the private template, which ones should stay product-specific, and how the first
TanStack Start migration should be deployed without breaking the current hosted
reference app.

## Current Template Host

The current template host is a Vite static Cloudflare Pages app:

- URL: `https://maestro-template.pages.dev`
- Build command: `pnpm build`
- Output directory: `apps/web/dist`
- Local static smoke: `pnpm smoke:web-static`
- Hosted smoke: `pnpm smoke:hosted`, `pnpm smoke:hosted:browser`,
  `pnpm smoke:hosted:visual`

## Deployment Decision

Use TanStack Start as the committed app runtime direction, but do not replace
the working Vite static Cloudflare Pages deploy until a TanStack Start static
build has equivalent local static smoke, hosted HTTP smoke, hosted browser
smoke, hosted visual smoke, rollback instructions, and documented Cloudflare
behavior.

First deployment target:

- Preferred: TanStack Start static output on Cloudflare Pages, if it produces an
  equivalent `apps/web/dist` artifact and passes the same smoke tests.
- Deferred: Cloudflare Workers SSR. Use this only after explicit environment
  mapping for WorkOS, Convex, PostHog, and provider secrets is documented, with
  a rollback command back to the Vite static deploy.

Rollback command until Start deploy is accepted:

```bash
git revert <tanstack-start-runtime-commit>
pnpm build
pnpm smoke:web-static
pnpm deploy:cloudflare
```

## Dependency Families To Add

Add these families in Task 8.1 or later, pinned and tested together:

- TanStack Start/runtime: `@tanstack/react-start`, `@tanstack/react-router`,
  `@tanstack/react-query`, `@tanstack/react-router-ssr-query`.
- Convex query bridge: `@convex-dev/react-query`.
- WorkOS/AuthKit Start bridge: `@workos/authkit-tanstack-react-start`.
- Notion Kit: `@notion-kit/ui`, `@notion-kit/settings-panel`,
  `@notion-kit/schemas`.
- Optional Notion Kit modules after approval: `@notion-kit/code-block`,
  `@notion-kit/table-view`, and any private tarball such as `@notion-kit/i18n`.
- Visual/runtime support: `lucide-react`, `@fontsource-variable/geist`,
  `@fontsource-variable/jetbrains-mono`, Tailwind v4 and `@tailwindcss/vite`
  only if the Maestro token bridge is ported.
- Keep `@xyflow/react` for workflow canvas surfaces only.

## Source Mapping

| Template primitive                   | Maestro source                                                                                                                                                                                                                         | Template destination                                                  | Port posture                                                                                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Start entry                 | `/Users/headless/maestro/apps/web/src/start.ts`                                                                                                                                                                                        | `apps/web/src/start.ts`                                               | Port after static deploy acceptance criteria are written.                                                                                                                                                         |
| Router factory                       | `/Users/headless/maestro/apps/web/src/router.tsx`                                                                                                                                                                                      | `apps/web/src/router.tsx`                                             | Port the `ConvexQueryClient`, `QueryClient`, generated `routeTree`, SSR query integration, `defaultPreload: "intent"`, and `scrollRestoration: true` shape.                                                       |
| Root route/provider tree             | `/Users/headless/maestro/apps/web/src/routes/__root.tsx`                                                                                                                                                                               | `apps/web/src/routes/__root.tsx`                                      | Port provider layering, but replace Maestro title/description and product copy.                                                                                                                                   |
| Workspace layout route               | `/Users/headless/maestro/apps/web/src/routes/_workspace.tsx`                                                                                                                                                                           | `apps/web/src/routes/_workspace.tsx`                                  | Port route-thinness pattern only; template routes must compose generic screens/features.                                                                                                                          |
| Current investor route               | `apps/web/src/sample/App.tsx` in this repo                                                                                                                                                                                             | `apps/web/src/routes/index.tsx` or equivalent Start route             | Preserve as a calm reviewer document route until replacement surfaces have equivalent smoke coverage.                                                                                                             |
| Notion stylesheet boundary           | `/Users/headless/maestro/apps/web/src/notion.css`                                                                                                                                                                                      | `apps/web/src/notion.css`                                             | Port scoped `@notion-kit/ui/style.css` strategy; keep kit CSS isolated to shell routes.                                                                                                                           |
| Token bridge/global CSS              | `/Users/headless/maestro/apps/web/src/index.css`                                                                                                                                                                                       | `apps/web/src/index.css`                                              | Port semantic tokens, font stack, focus, motion, and density. Remove Maestro product palette names.                                                                                                               |
| Shell provider/inset                 | `/Users/headless/maestro/apps/web/src/components/shell/shell.tsx`                                                                                                                                                                      | `packages/ui/src/shell/app-shell.tsx`                                 | Move reusable shell primitive into template UI package.                                                                                                                                                           |
| Workspace sidebar                    | `/Users/headless/maestro/apps/web/src/components/shell/workspace-sidebar.tsx`                                                                                                                                                          | `packages/ui/src/shell/workspace-sidebar.tsx`                         | Port Notion Kit sidebar primitives and typed item adapters.                                                                                                                                                       |
| Topbar/navbar                        | `/Users/headless/maestro/apps/web/src/components/shell/topbar.tsx`                                                                                                                                                                     | `packages/ui/src/shell/topbar.tsx`                                    | Port `Navbar`, `SidebarOpen`, and compact command/action area.                                                                                                                                                    |
| Sidebar route/action/footer adapters | `/Users/headless/maestro/apps/web/src/components/shell/sidebar-*.tsx`                                                                                                                                                                  | `packages/ui/src/shell/sidebar-*.tsx`                                 | Port generic adapters; remove Maestro route labels and product actions.                                                                                                                                           |
| Theme scope                          | `/Users/headless/maestro/apps/web/src/components/shell/theme-scope.tsx`                                                                                                                                                                | `packages/ui/src/shell/theme-scope.tsx`                               | Port only if needed for Notion stylesheet scoping and theme classes.                                                                                                                                              |
| Navigation registry                  | `/Users/headless/maestro/apps/web/src/navigation/workspace-config.ts`, `/Users/headless/maestro/apps/web/src/navigation/workspace.ts`, `/Users/headless/maestro/apps/web/src/navigation/legal-links.ts`                                | `apps/web/src/navigation/*`                                           | Port data shape; replace routes with Home, Brain, Workflows, Capabilities, Agents, Runs, Documents, Sources, Integrations, API, Onboarding, Data Map, Notifications, Settings, Billing, Analytics, Health, Admin. |
| Reusable blocks                      | `/Users/headless/maestro/apps/web/src/components/blocks/*`                                                                                                                                                                             | `packages/ui/src/blocks/*`                                            | Port layout and state blocks that are business-neutral. Keep BlockNote/ProseMirror/editor-specific blocks optional.                                                                                               |
| Settings dashboard                   | `/Users/headless/maestro/apps/web/src/features/settings/settings-dashboard.tsx` and adjacent settings cards                                                                                                                            | `apps/web/src/features/settings/*`                                    | Port with `@notion-kit/settings-panel`; replace LinkedIn/product integrations with WorkOS, PostHog, Dodo, MailerSend, storage, search, LLM, Convex.                                                               |
| Onboarding progress                  | `/Users/headless/maestro/apps/web/src/features/onboarding/*`                                                                                                                                                                           | `apps/web/src/features/onboarding/*`                                  | Port progress model for first workspace, Brain source import, first capability, first workflow, provider posture, deploy readiness.                                                                               |
| Health dashboard                     | `/Users/headless/maestro/apps/web/src/features/health/*`                                                                                                                                                                               | `apps/web/src/features/settings` or `apps/web/src/features/health`    | Port provider/status pattern; keep provider SDK construction out of UI.                                                                                                                                           |
| Workflow screen                      | `/Users/headless/maestro/apps/web/src/screens/workflows-screen.tsx`                                                                                                                                                                    | `apps/web/src/features/workflows/*` and route screen                  | Port screen composition around durable workflow metadata.                                                                                                                                                         |
| Workflow React Flow adapter          | `/Users/headless/maestro/apps/web/src/features/workflows/workflow-canvas-state.ts`, `workflow-canvas-adapter.ts`, `workflow-canvas-surface.tsx`, `workflow-canvas-workspace.tsx`, `components/node-types/*`, `components/edge-types/*` | `packages/workflow-ui/src/*` plus `apps/web/src/features/workflows/*` | Port derivation from durable graph metadata; do not persist React Flow nodes/edges or generic `data` bags.                                                                                                        |
| Confect/Convex state adapters        | Maestro route/provider patterns plus current template Confect refs                                                                                                                                                                     | `apps/web/src/adapters/confect-state.ts`                              | Add generic query/mutation state normalization in Task 8.3.                                                                                                                                                       |
| WorkOS auth adapters                 | `/Users/headless/maestro/apps/web/src/adapters/workos-auth.ts`, `workos-auth-loader.ts`                                                                                                                                                | `apps/web/src/adapters/workos-auth*.ts`                               | Port fake/live boundary and loader pattern.                                                                                                                                                                       |
| PostHog provider                     | `/Users/headless/maestro/apps/web/src/providers/posthog.tsx`                                                                                                                                                                           | `apps/web/src/providers/posthog.tsx`                                  | Port provider shell only; no product-specific events by default.                                                                                                                                                  |

## Do Not Port By Default

- Maestro-specific routes such as posts, lead magnets, LinkedIn, ghostwriting,
  voice DNA, client-specific workflows, and content pipeline surfaces.
- Maestro product copy, launch strategy, real customer examples, or internal
  investor-sensitive notes.
- Provider SDK construction inside UI components.
- React Flow persistence shapes. Durable workflow graphs live in Confect/Convex
  metadata; React Flow is only the interaction layer.
- Editor-heavy BlockNote/ProseMirror surfaces unless a fork explicitly needs
  rich collaborative document editing.

## Acceptance Criteria Before Task 8.1 Is Complete

- The current Vite reference app still builds and passes static smoke.
- The investor document route remains reachable and readable.
- The TanStack Start route tree is generated, not hand-authored.
- The provider tree is thin and contains no route-local business logic.
- Notion Kit CSS is loaded through a scoped stylesheet boundary.
- Browser and visual smoke prove desktop and mobile first-viewport behavior.
