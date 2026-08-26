# Maestro Brain CLI

Standalone terminal client for teammates and agents. Requires Node 22.

```bash
npm install --global @modernagencysales/maestro-brain
maestro-brain setup
eval "$(maestro-brain env)"
maestro-brain doctor
maestro-brain ask "What is our ICP?"
```

Setup opens the stable Maestro Brain terminal-link page and accepts its result
only through a state-bound loopback callback. It stores the linked workspace key
and Brain API origin with user-only file permissions, then creates Codex, Claude
Code, Claude Cowork, and Ask Apero project configuration without embedding the
key in agent config files. Codex HTTP MCP still requires the bearer environment
variable, so source it into each agent terminal with the printed `eval` command.

`logout` removes the local CLI configuration. It cannot revoke a server-side API
key; use browser settings for revocation.
