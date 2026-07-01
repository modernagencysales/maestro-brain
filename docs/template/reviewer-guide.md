# Reviewer Guide

This guide is the 30-minute technical diligence path.

For the executive technical packet, start with
[investor-reviewer-packet.md](./investor-reviewer-packet.md).

## 1. Run The Repo Locally

```bash
pnpm install
pnpm review:readiness
pnpm check:format
pnpm lint
pnpm typecheck
host-test-slot --class full pnpm test
pnpm build
```

Start the reference app:

```bash
pnpm --dir apps/web dev -- --port 5174
```

Open `http://127.0.0.1:5174/`. The first screen is the generic AI operations
workspace: Brain, workflows, capabilities, agents, integrations, headless
surfaces, and safety posture.

The hosted static reference app is available at:

```text
https://maestro-template.pages.dev
```

If port `5174` is busy, use any free port:

```bash
pnpm --dir apps/web dev -- --port 5184
```

## 2. Inspect The Product Surfaces

Open the reference app and inspect:

- reusable app shell and navigation from `packages/ui`;
- React Flow workflow primitive from `packages/workflow-ui`;
- Brain/source/context/trust receipt model;
- capabilities, agents, and workflow composition model;
- API/CLI/MCP and provider adapter posture;
- safety model and generated contract checklist.

The app intentionally uses reviewer-safe synthetic data and fake/local provider
posture. The canonical typed registry lives in
`packages/template-core/src/index.ts`; the web app imports it through
`apps/web/src/sample/templateData.ts`. Tests for section coverage and workflow
graph integrity live in `apps/web/src/sample/templateData.test.ts`.

The headless projection lives in `tooling/workflow/src/index.ts`. It turns the
same capability registry into stable operation metadata for future API, CLI,
MCP, and Scalar generation.

Inspect the same registry through the CLI:

```bash
pnpm exec tsx apps/cli/src/index.ts describe
pnpm exec tsx apps/cli/src/index.ts operations list
pnpm exec tsx apps/cli/src/index.ts operations get CLI:createTrustReceipt
pnpm exec tsx apps/cli/src/index.ts workflow run
pnpm exec tsx apps/cli/src/index.ts api catalog
pnpm exec tsx apps/cli/src/index.ts api openapi
pnpm exec tsx apps/cli/src/index.ts mcp tools
pnpm exec tsx apps/cli/src/index.ts mcp call template.workflow.run
pnpm exec tsx apps/cli/src/index.ts integrations report fake
pnpm template:init -- --name "Reviewer Brain"
```

`api openapi` prints an OpenAPI 3.1 document generated from the same headless
registry as the web sample and CLI. The same document is served by the backend
HTTP docs route in `packages/convex/confect/http.ts` at `/api/openapi.json`,
with the Scalar shell at `/api/docs`. The same route also mounts reviewer-safe
executable `POST /api/<operation>` handlers backed by the shared template
registry; `packages/convex/test/http-docs.test.ts` proves
`POST /api/createTrustReceipt` returns the sample Trust Receipt path.

`mcp call template.workflow.run` invokes the deterministic reviewer-safe
workflow through the same registry and returns the workflow receipt as an
MCP-style tool result.

`template:init` prints the client-instance manifest. Use `--write` when you want
to create `template-instance.json`, then run
`pnpm template:doctor -- --mode fake`.

## 3. Run One Workflow

The current app shows the workflow authoring primitive and a deterministic
reviewer-safe run receipt. Inspect the same receipt through:

- web workflow builder;
- CLI command `workflow run`;
- future MCP tool.

Inspect the run receipt, audit event, and Trust Receipt.

## 4. Inspect Confect

Open one Confect spec, its impl, and generated refs. Confirm args, returns, and
expected errors are Effect schemas and that callers use generated refs. Then
inspect `packages/convex/test/confect-contracts.test.ts`, which checks generated
ref metadata, capability schema validation, public-safe typed errors, and plain
Convex registration shape without requiring a live Convex deployment.

## 5. Inspect Operations

Read:

- [operations-runbook.md](./operations-runbook.md)
- [data-lifecycle.md](./data-lifecycle.md)
- [security.md](./security.md)

Confirm deploy, rollback, export/delete, and support access are documented.

## 6. Run Fast Verification

```bash
pnpm check:format && pnpm lint && pnpm typecheck && host-test-slot --class full pnpm test && pnpm build
```

For the full deterministic gate chain, use:

```bash
host-test-slot --class full pnpm verify
```

## 7. Smoke The Static Reference App

```bash
pnpm build
pnpm smoke:web-static
pnpm smoke:hosted
pnpm smoke:hosted:browser
pnpm smoke:hosted:visual
```

The smoke verifies the static web output under `apps/web/dist`, which can be
served by Vercel, Cloudflare Pages, Netlify, or another static host. The visual
smoke adds desktop and mobile screenshot-diff coverage for the investor-visible
first viewport and the workflow/trust receipt section.
