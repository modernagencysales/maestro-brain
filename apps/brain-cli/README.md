# Maestro Brain CLI

Standalone terminal client for teammates and agents. Requires Node 22.

```bash
npm install --global https://github.com/modernagencysales/maestro-brain/releases/latest/download/maestro-brain.tgz
maestro-brain setup
eval "$(maestro-brain env)"
maestro-brain doctor
maestro-brain ask "What is our ICP?"
maestro-brain evidence search "What is our ICP?"
maestro-brain evidence health
```

Run `maestro-brain update` later to print the stable install command for the
newest published CLI release.

Setup opens the stable Maestro Brain terminal-link page and accepts its result
only through a state-bound loopback callback. It stores the linked workspace key
and Brain API origin with user-only file permissions, then creates Codex, Claude
Code, Claude Cowork, and Ask Apero project configuration without embedding the
key in agent config files. Codex HTTP MCP still requires the bearer environment
variable, so source it into each agent terminal with the printed `eval` command.
Claude Cowork may require adding the generated `.cowork/maestro-brain.json` HTTP
connector through its connector UI when project descriptors are not discovered
automatically.

The canonical read flow is `evidence search` followed by `evidence source-get`
with the exact source and revision keys returned by search. Both commands use
the same hosted HTTP MCP tools that Codex, Claude Code, and Cowork discover.
`evidence health` reports bounded provider counts, index coverage, capacity, and
the latest connector-run state. It is an operational observation, not a
readiness claim.

`logout` removes the local CLI configuration. It cannot revoke a server-side API
key; use browser settings for revocation.
