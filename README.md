# Maestro Template

Maestro Template is a private internal framework for building custom AI brain,
workflow, and context-engineering apps. It extracts the reusable Maestro
architecture into a generic product factory: workspace tenancy, Confect/Effect
contracts, workflows, capabilities, agents, Brain sources, headless surfaces,
provider adapters, CI gates, and a reviewer-safe reference app.

This is not a public starter kit. It is an internal accelerator for custom AI
implementation work and technical diligence.

The current product direction is to use this foundation as Apero's shared,
evidence-backed company context plane between systems of record and agent
runtimes. See
[Apero Company Brain Architecture](./docs/product/apero-company-brain-architecture.md)
for the proposed source, retrieval, credential, and tool-calling boundaries.

## Company Brain terminal quickstart

Teammates using Codex, Claude Code, or Claude Cowork can connect to the shared
Brain without running the web app. Create a display-once key with `brain:read`
and `brain:ask` at
[`/settings`](https://maestro-brain-staging.tim-bb0.workers.dev/settings), then:

Install the Brain checkout once, then invoke its executable from the repository
where the teammate actually works. This preserves that project's working
directory, so setup, Markdown notes, and snapshots use the expected paths.

```bash
export BRAIN_REPO="/absolute/path/to/maestro-brain"
export BRAIN_CLI="$BRAIN_REPO/apps/cli/bin/maestro-brain.mjs"
pnpm --dir "$BRAIN_REPO" install --frozen-lockfile

cd /path/to/the-teammates-project
export CONVEX_SITE_URL="https://perfect-sparrow-808.convex.site"
export MAESTRO_BRAIN_API_KEY="<display-once-key>"
"$BRAIN_CLI" setup codex # or claude-code / cowork
"$BRAIN_CLI" doctor
"$BRAIN_CLI" ask "What is our ICP?"
"$BRAIN_CLI" mcp tools
```

Automation can target a project without changing directories:

```bash
"$BRAIN_CLI" setup codex --repo /path/to/project
```

Setup copies the shared Ask Apero skill into the target project and writes
project-local runtime configuration, so the project remains usable without a
symlink back to the Brain checkout. Cowork users import the generated
`.cowork/maestro-brain.json` descriptor through Cowork's connector UI. See
[terminal testing](./company-context/terminal-testing.md) for adding notes,
inspecting/importing Markdown snapshots, and the acceptance checklist.

## Quickstart

```bash
pnpm install
pnpm review:readiness
pnpm review:completion
pnpm check:format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`review:readiness` and `review:completion` are presence/evidence audits. They
check required files and listed evidence paths; run `pnpm verify` for behavioral
proof.

Run the hostable reference app:

```bash
pnpm --dir apps/web dev -- --port 5174
```

Open `http://127.0.0.1:5174/`.

Hosted reference app:

```text
https://maestro-template.pages.dev
```

For a technical diligence path, start with
[docs/template/investor-reviewer-packet.md](./docs/template/investor-reviewer-packet.md).

The hosted app is a working full-stack deployment: the Workflows page streams
live data from a deployed Convex backend, and every push to `main` runs the full
Buildkite gate pipeline (deterministic gates, LLM review gates, staging deploy,
gated production promote). Other providers (WorkOS, PostHog, Dodo, MailerSend,
storage, LLM) default to fake/local adapters and are switched on per client
fork.

## Design decisions

Fresh reviewers tend to flag the same four things. Each one is a decision, not
an accident:

- **Auth is a seam, not a feature.** The template ships fake-safe identity
  wiring (WorkOS-shaped) and a server-derived tenancy spine, but no live auth
  flow. Client forks choose their own provider; the template's job is to make
  that a contained swap instead of a rewrite.
- **Some backend capabilities are contract fixtures.** Domains that manage live
  data (`access`, `auth`, `brain`, `demo`) are database-backed. Domains that
  demonstrate contract shape (`ops/*`, `agents`, `capabilities`, `jobs`) return
  deterministic fixtures behind real typed specs. The spec, typed errors, and
  tests are the deliverable; a fork replaces fixture bodies with persistence.
  See AGENTS.md for the exact map.
- **The live surface is deliberately thin.** One seeded workspace and one live
  query prove the full path (static app → deployed backend → typed contract →
  UI). Everything else stays inert until a client fork gives it real data. A
  template that pretends to be a product ages badly.
- **`repos/` vendors Effect and Confect sources on purpose.** AI coding agents
  produce measurably better changes with framework source in-tree. It is
  reference material, excluded from builds, lint, and scanning.

How this repo was built — and why the commit history looks the way it does — is
documented in
[docs/template/delivery-story.md](./docs/template/delivery-story.md). The fast
receipt path is
[docs/template/delivery-receipts.md](./docs/template/delivery-receipts.md).

## Architecture

```text
web routes -> screens -> features -> blocks -> Saas UI/shared primitives
client hooks -> @confect/react refs -> Confect specs -> Convex functions
agents -> workflows -> capabilities -> domain/checks -> schema
API/CLI/MCP -> headless registry -> same capabilities/workflows as web
storage/notifications/observability -> Effect services -> provider adapters
admin/support/privacy -> audited capabilities -> narrow operator surfaces
```

## Reference App Routes

The reference app converges on these default surfaces:

- Home
- Brain
- Workflows
- Capabilities
- Agents
- Runs
- Documents
- Source Intake
- Integrations
- API
- Onboarding
- Data Map
- Notifications
- Settings
- Billing
- Analytics
- Health
- Admin/Support

The default first screen is a plain Saas UI business dashboard. It demonstrates
the intended frontend path with a live `demo.showcase.overview` Confect query,
and `/data-lifecycle` demonstrates the fake-safe Confect query/mutation pattern
that client forks should copy first.

## Verification

Fast local verification:

```bash
pnpm check:format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Investor completion audit:

```bash
pnpm review:completion
```

Full verification after safety gates land:

```bash
pnpm verify
```

## Navigation

- Agent instructions: [AGENTS.md](./AGENTS.md)
- Apero company-brain direction:
  [docs/product/apero-company-brain-architecture.md](./docs/product/apero-company-brain-architecture.md)
- Apero company-brain specification:
  [docs/product/apero-company-brain-spec.md](./docs/product/apero-company-brain-spec.md)
- Apero company-brain implementation plan:
  [docs/product/apero-company-brain-implementation-plan.md](./docs/product/apero-company-brain-implementation-plan.md)
- Repo map: [docs/template/repo-map.md](./docs/template/repo-map.md)
- Reviewer guide:
  [docs/template/reviewer-guide.md](./docs/template/reviewer-guide.md)
- Investor reviewer packet:
  [docs/template/investor-reviewer-packet.md](./docs/template/investor-reviewer-packet.md)
- Extraction policy:
  [docs/template/extraction-redaction-guide.md](./docs/template/extraction-redaction-guide.md)
- Confect/Effect guide:
  [docs/template/confect-effect-guide.md](./docs/template/confect-effect-guide.md)
- Golden path business slice:
  [docs/template/golden-path-business-slice.md](./docs/template/golden-path-business-slice.md)
