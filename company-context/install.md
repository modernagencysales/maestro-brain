# Ask Apero Runtime Installation

Install both runtimes from the same reviewed Git revision and
[`team-manifest.v1.json`](team-manifest.v1.json). Do not begin dogfood while a
runtime's live-parity status is `pending` or an owner-dependent manifest field
is `TBD`.

## Required configuration

Configuration names:

- `CONVEX_SITE_URL` — approved HTTPS site origin; not a secret;
- `MAESTRO_BRAIN_API_KEY` — runtime-local bearer credential; secret.

Provision a separate existing read-only service identity for each installed
runtime. Each credential must be scoped to `brain:read`, have a viewer ceiling,
and derive the organization, workspace, and Brain scope server-side. Do not add
a Brain key or tenant selector to prompts or tool input. Do not share one
credential between Codex and Claude Code, and never commit a credential value.

The MCP connection is named `maestro-brain`, uses streamable HTTP at the
approved `${CONVEX_SITE_URL}/mcp` endpoint, and sends `MAESTRO_BRAIN_API_KEY` as
a bearer token. Store the secret with the runtime's approved local secret
mechanism.

## Install the shared skill

From the repository root, create the runtime discovery directories if needed.
Then add links only when the destinations do not already exist:

```bash
mkdir -p .agents/skills .claude/skills
test ! -e .agents/skills/ask-apero
ln -s ../../company-context/skills/ask-apero .agents/skills/ask-apero
test ! -e .claude/skills/ask-apero
ln -s ../../company-context/skills/ask-apero .claude/skills/ask-apero
```

Codex scans repository skills under `.agents/skills` and supports symlinked
skill directories. Claude Code uses the repository's existing `.claude/skills`
convention. Both links resolve to one canonical `SKILL.md`. Restart a runtime if
it does not discover the new skill.

## Configure Codex

In user-local `~/.codex/config.toml`, or a trusted project-scoped
`.codex/config.toml`, configure the approved concrete endpoint without placing
the bearer value in the file:

```toml
[mcp_servers.maestro_brain]
url = "https://approved-site-origin.example/mcp"
bearer_token_env_var = "MAESTRO_BRAIN_API_KEY"
```

Replace the example origin with the approved `CONVEX_SITE_URL`. Confirm the
connection with `codex mcp list` and `/mcp`. See the official OpenAI
documentation for
[Codex MCP configuration](https://developers.openai.com/codex/mcp/) and
[repository skill discovery](https://developers.openai.com/codex/skills/).

## Configure Claude Code

Use project scope and the pinned runtime's native HTTP MCP configuration. The
equivalent `.mcp.json` shape is:

```json
{
  "mcpServers": {
    "maestro-brain": {
      "type": "http",
      "url": "${CONVEX_SITE_URL}/mcp",
      "headers": {
        "Authorization": "Bearer ${MAESTRO_BRAIN_API_KEY}"
      }
    }
  }
}
```

Keep `.mcp.json` free of resolved secret values. Confirm the connection with the
pinned Claude Code version's MCP status command before invoking the skill.

## Smoke check

1. Confirm the installed runtime version exactly matches a manifest entry.
2. Confirm only the reviewed read tools are available.
3. Invoke `$ask-apero` in Codex or `/ask-apero` in Claude Code with an approved
   non-sensitive E0 prompt identifier's question text from the restricted
   evaluation location.
4. Require ContextPack schema version `3`, candidate-manifest version `2`, a
   request ID, exact citation tuples, and explicit coverage/freshness.
5. Record the runtime version and ordered candidate-manifest hash in the
   immutable runtime-parity receipt. Do not record source bodies or secrets.

The durable wrong/stale path is API-only at
`/api/brain.feedback.reportWrongOrStale` and uses the same bearer-derived Brain
scope. It stores request/candidate identity, exact citation tuples, readiness,
category/disposition, and optional evaluation-rerun linkage without source or
answer text. Do not expose it as an MCP/provider write tool.
