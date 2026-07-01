# How To Add An Agent

Use the agent generator:

```bash
pnpm template:add-agent-seat -- --name workflow_architect
```

## Files Created

- Agent seat metadata.
- Tool grant manifest.
- Prompt and policy refs.
- Conversation/thread Confect functions.
- Web agent surface.
- Tests and docs.

## Tests

- tool grant acceptance and refusal;
- prompt-injection fixture;
- unsupported request refusal;
- memory approval;
- capability permission;
- policy snapshot;
- tool-call telemetry.

## Gates

- `pnpm --dir packages/convex test agents`
- `pnpm --dir apps/web test src/features/agents`
- `pnpm check:headless-surface-contract` when exposed.
