# Company Brain terminal testing

This is the shortest path for a teammate to connect a terminal agent to the
hosted Company Brain. It does not require the web application.

## What the operator provides

- the hosted `CONVEX_SITE_URL`, including `https://` and no path;
- a `MAESTRO_BRAIN_API_KEY` issued for the Company Brain with `brain:read` and
  `brain:ask` scopes;
- a checkout of this repository containing the CLI and shared Ask Apero skill.

Keep both values in the terminal's secret environment. Setup writes references
to those environment variables; it never writes the bearer value into a config
file.

```bash
export BRAIN_REPO="/absolute/path/to/maestro-brain"
export BRAIN_CLI="$BRAIN_REPO/apps/cli/bin/maestro-brain.mjs"
export CONVEX_SITE_URL="https://your-company-brain.example"
export MAESTRO_BRAIN_API_KEY="..."
pnpm --dir "$BRAIN_REPO" install --frozen-lockfile
```

## Connect a runtime

Change into the repository where the teammate's agent works, then run setup for
that terminal. The CLI executable lives in the Brain checkout but preserves the
caller's working directory.

```bash
cd /path/to/teammate-project
"$BRAIN_CLI" setup codex
"$BRAIN_CLI" setup claude-code
"$BRAIN_CLI" setup cowork
```

For automation, `"$BRAIN_CLI" setup codex --repo /path/to/project` targets a
repository explicitly.

Codex setup copies the shared Ask Apero skill and adds the remote HTTP MCP
server to Codex configuration. Claude Code setup copies the same skill and adds
the server to `.mcp.json`. Cowork setup writes a portable HTTP MCP descriptor to
`.cowork/maestro-brain.json`; enter its settings in Cowork's connector UI. Ask
Apero instructions are then discovered from the server through MCP prompts.

Setup refuses to overwrite a conflicting skill directory or MCP server entry.
This makes it safe to run in a repository that already has other skills or MCP
servers configured.

## Verify the connection

```bash
"$BRAIN_CLI" doctor
"$BRAIN_CLI" health
"$BRAIN_CLI" ask "What is our ICP?"
"$BRAIN_CLI" search "gross margin"
"$BRAIN_CLI" source "citation:<publication-set-key>:<entry-key>"
"$BRAIN_CLI" mcp tools
```

`doctor` checks the API and the remote MCP handshake, including availability of
the server-delivered `ask-apero` prompt and bearer-scoped hosted tool schemas.
`mcp tools` prints that live HTTP catalog rather than the repository's offline
template registry. `health` reports ingestion coverage, freshness, alerts, and
rollout readiness. Answers and source results retain the server's citation and
freshness metadata.

The generic operation escape hatch remains available for debugging:

```bash
"$BRAIN_CLI" api call brain.context.get --input '{"question":"What is our ICP?"}'
```

Do not add organization, workspace, Brain, or user identifiers to input. The
server derives Company Brain scope from the bearer key.

## Add or correct data

Normal company data should be added to its system of record. Connected Drive,
Slack, and call-transcript providers reconcile it into the Brain, and `health`
shows whether the resulting corpus is current and complete.

For a wrong or stale answer, submit the identifiers returned with that answer:

```bash
"$BRAIN_CLI" feedback --idempotency-key feedback-<unique-id> --input '<feedback-json>'
```

Feedback records evidence identities and readiness state, not copied source or
answer text. The interactive runtime key's `brain:ask` scope also permits a note
submission to the existing review queue:

```bash
"$BRAIN_CLI" note --input '{"title":"Updated positioning","markdown":"Reviewed company context..."}'
"$BRAIN_CLI" note --file ./updated-positioning.md
printf '%s\n' 'Reviewed company context...' | "$BRAIN_CLI" note --stdin --title 'Updated positioning'
```

Prefer `--file` or `--stdin` for agent-authored Markdown so multiline content
does not need shell-escaped JSON. A file's first H1 becomes its title; without
an H1, the filename is used. Piped Markdown needs `--title` unless it starts
with an H1. These commands submit the same reviewed note and never publish
directly. Exact retries are idempotent: a timeout followed by the same note
returns the existing review item, while reusing a retry identity for changed
content fails instead of silently overwriting or duplicating evidence.

To migrate an approved Claude Project or another reviewed Markdown snapshot, put
its `.md` files in one local directory and submit them together:

```bash
"$BRAIN_CLI" snapshot inspect ./apero-snapshot --as-of 2026-08-22
"$BRAIN_CLI" snapshot submit ./apero-snapshot --as-of 2026-08-22
```

`inspect` performs all local validation without credentials or network access
and prints file order, derived titles, and byte counts—but never document
bodies. `submit` walks those files in the same order, stamps every page with the
required snapshot source and date, and stops at the first rejected submission.
Override the default source label with `--source <name>` when importing
something other than the Ask Apero Claude Project. Every submitted file still
enters `pending_review`; the context owner approves or rejects it in the Brain
review queue. Retrying the same snapshot is safe; the result reports per-status
counts when earlier files have already been approved or rejected.

The note does not become retrieval evidence until an editor approves it in the
existing review workflow. Write operations are intentionally unavailable over
MCP, so an agent cannot silently modify its own evidence.

## Tester acceptance check

A tester is ready when all of the following are true:

1. `"$BRAIN_CLI" doctor` exits successfully.
2. Their runtime lists the `maestro-brain` HTTP MCP server.
3. Ask Apero returns ContextPack schema version 3 and candidate manifest
   version 2.
4. Material claims include reopenable publication/entry citations.
5. The answer states freshness and any coverage gaps or abstains when evidence
   is insufficient.
6. `"$BRAIN_CLI" health` shows any unavailable provider plainly.

If setup or doctor fails, share the command output, runtime name and version,
and the hosted origin. Never share the bearer value or retrieved source bodies.
