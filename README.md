# Maestro Template

Maestro Template is a private internal framework for building custom AI brain,
workflow, and context-engineering apps. It extracts the reusable Maestro
architecture into a generic product factory: workspace tenancy, Confect/Effect
contracts, workflows, capabilities, agents, Brain sources, headless surfaces,
provider adapters, CI gates, and a reviewer-safe reference app.

This is not a public starter kit. It is an internal accelerator for custom AI
implementation work and technical diligence.

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

## Architecture

```text
web routes -> screens -> features -> blocks -> Notion Kit
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
- Repo map: [docs/template/repo-map.md](./docs/template/repo-map.md)
- Reviewer guide:
  [docs/template/reviewer-guide.md](./docs/template/reviewer-guide.md)
- Investor reviewer packet:
  [docs/template/investor-reviewer-packet.md](./docs/template/investor-reviewer-packet.md)
- Extraction policy:
  [docs/template/extraction-redaction-guide.md](./docs/template/extraction-redaction-guide.md)
- Confect/Effect guide:
  [docs/template/confect-effect-guide.md](./docs/template/confect-effect-guide.md)
