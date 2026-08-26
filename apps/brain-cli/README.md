# Maestro Brain CLI

Standalone terminal client for teammates and agents. Requires Node 22.

```bash
npm install --global https://github.com/modernagencysales/maestro-brain/releases/download/brain-cli-v0.1.4/maestro-brain.tgz
maestro-brain setup
eval "$(maestro-brain env)"
maestro-brain doctor
maestro-brain run -- codex
maestro-brain ask "What is our ICP?"
maestro-brain evidence search "What is our ICP?"
maestro-brain evidence health
```

Run `maestro-brain update` later to print the version-pinned install command.
The pinned URL avoids npm reusing a stale cached response from GitHub's
`releases/latest` redirect.

Setup opens the stable Maestro Brain terminal-link page and accepts its result
only through a state-bound loopback callback. It stores the linked workspace key
and Brain API origin with user-only file permissions, then creates Codex, Claude
Code, Claude Cowork, and Ask Apero project configuration without embedding the
key in agent config files. Codex HTTP MCP still requires the bearer environment
variable, so source it into each agent terminal with the printed `eval` command.
Alternatively, `maestro-brain run -- codex` or `maestro-brain run -- claude`
launches the agent with the stored key injected only into that child process.
Claude Cowork may require adding the generated `.cowork/maestro-brain.json` HTTP
connector through its connector UI when project descriptors are not discovered
automatically.

The canonical read flow is `evidence search` followed by `evidence source-get`
with the exact source and revision keys returned by search. Both commands use
the same hosted HTTP MCP tools that Codex, Claude Code, and Cowork discover.
`evidence health` reports bounded provider counts, index coverage, capacity, and
the latest connector-run state. It is an operational observation, not a
readiness claim.

`page list` returns metadata and Markdown byte counts by default so agents do
not spend context on every page body. Use `page list --full` when the bodies are
actually required. Likewise, `mcp tools` returns tool names and descriptions;
use `mcp tools --full` to inspect the complete JSON schemas.

`maestro-brain import <folder>` is repeatable: it creates missing pages, updates
changed Markdown and titles only on pages carrying the same persisted import
identity, and skips unchanged pages. Manual, archived, or duplicate collisions
fail closed before writes. It never archives a Brain page merely because the
corresponding local file is absent.

For a folder first imported with CLI `0.1.1`, review the same-slug pages and run
`maestro-brain import <folder> --adopt-existing` once. Adoption is explicit,
revision-fenced, and limited to active pages with no existing import owner.

`logout` removes the local CLI configuration. It cannot revoke a server-side API
key; use browser settings for revocation.
