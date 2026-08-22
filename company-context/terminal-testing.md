# Company Brain terminal testing

This is the shortest path for a teammate to connect a terminal agent to the
hosted Company Brain. It does not require the web application.

## What the operator provides

- the hosted `CONVEX_SITE_URL`, including `https://` and no path;
- a `MAESTRO_BRAIN_API_KEY` issued for the Company Brain;
- a checkout of this repository when installing the shared Ask Apero skill.

Keep both values in the terminal's secret environment. Setup writes references
to those environment variables; it never writes the bearer value into a config
file.

```bash
export CONVEX_SITE_URL="https://your-company-brain.example"
export MAESTRO_BRAIN_API_KEY="..."
pnpm install
```

## Connect a runtime

Run the setup command for the terminal the teammate uses:

```bash
pnpm brain setup codex
pnpm brain setup claude-code
pnpm brain setup cowork
```

Codex setup installs the shared Ask Apero skill and adds the remote HTTP MCP
server to Codex configuration. Claude Code setup installs the same skill and
adds the server to `.mcp.json`. Cowork setup emits a portable HTTP MCP
descriptor to enter in Cowork's connector UI; Ask Apero instructions are then
discovered from the server through MCP prompts.

Setup refuses to overwrite a conflicting skill link or MCP server entry. This
makes it safe to run in a repository that already has other skills or MCP
servers configured.

## Verify the connection

```bash
pnpm brain doctor
pnpm brain health
pnpm brain ask "What is our ICP?"
pnpm brain search "gross margin"
pnpm brain source "citation:<publication-set-key>:<entry-key>"
```

`doctor` checks the API and the remote MCP handshake, including availability of
the server-delivered `ask-apero` prompt. `health` reports ingestion coverage,
freshness, alerts, and rollout readiness. Answers and source results retain the
server's citation and freshness metadata.

The generic operation escape hatch remains available for debugging:

```bash
pnpm brain api call brain.context.get --input '{"question":"What is our ICP?"}'
```

Do not add organization, workspace, Brain, or user identifiers to input. The
server derives Company Brain scope from the bearer key.

## Add or correct data

Normal company data should be added to its system of record. Connected Drive,
Slack, and call-transcript providers reconcile it into the Brain, and `health`
shows whether the resulting corpus is current and complete.

For a wrong or stale answer, submit the identifiers returned with that answer:

```bash
pnpm brain feedback --input '<feedback-json>'
```

Feedback records evidence identities and readiness state, not copied source or
answer text. A key with the optional `brain:ask` scope can also submit a note to
the existing review queue:

```bash
pnpm brain note --input '{"title":"Updated positioning","markdown":"Reviewed company context..."}'
```

To migrate an approved Claude Project or another reviewed Markdown snapshot, put
its `.md` files in one local directory and submit them together:

```bash
pnpm brain snapshot submit ./apero-snapshot --as-of 2026-08-22
```

The command walks Markdown files in stable path order, uses each first-level
heading as its title, stamps every page with the required snapshot source and
date, and stops at the first rejected submission. Override the default source
label with `--source <name>` when importing something other than the Ask Apero
Claude Project. The command never prints document bodies. Every submitted file
still enters `pending_review`; the context owner approves or rejects it in the
Brain review queue.

The note does not become retrieval evidence until an editor approves it in the
existing review workflow. Write operations are intentionally unavailable over
MCP, so an agent cannot silently modify its own evidence.

## Tester acceptance check

A tester is ready when all of the following are true:

1. `pnpm brain doctor` exits successfully.
2. Their runtime lists the `maestro-brain` HTTP MCP server.
3. Ask Apero returns ContextPack schema version 3 and candidate manifest
   version 2.
4. Material claims include reopenable publication/entry citations.
5. The answer states freshness and any coverage gaps or abstains when evidence
   is insufficient.
6. `pnpm brain health` shows any unavailable provider plainly.

If setup or doctor fails, share the command output, runtime name and version,
and the hosted origin. Never share the bearer value or retrieved source bodies.
