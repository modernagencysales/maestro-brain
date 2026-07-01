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
pnpm check:format
pnpm lint
pnpm typecheck
host-test-slot --class full pnpm test
pnpm build
```

The template defaults to fake/local providers. Real Convex, WorkOS, PostHog,
Dodo, MailerSend, storage, and LLM credentials are added through typed provider
adapters in later setup steps.

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
pnpm check:format && pnpm lint && pnpm typecheck && host-test-slot --class full pnpm test && pnpm build
```

Full verification after safety gates land:

```bash
host-test-slot --class full pnpm verify
```

## Navigation

- Agent instructions: [AGENTS.md](./AGENTS.md)
- Repo map: [docs/template/repo-map.md](./docs/template/repo-map.md)
- Reviewer guide:
  [docs/template/reviewer-guide.md](./docs/template/reviewer-guide.md)
- Extraction policy:
  [docs/template/extraction-redaction-guide.md](./docs/template/extraction-redaction-guide.md)
- Confect/Effect guide:
  [docs/template/confect-effect-guide.md](./docs/template/confect-effect-guide.md)
