# Terminal Installation

Requires Node 22. Run from the project where the agent will work:

```bash
npm install --global https://github.com/modernagencysales/maestro-brain/releases/latest/download/maestro-brain.tgz
maestro-brain setup
eval "$(maestro-brain env)"
maestro-brain doctor
```

Setup writes project descriptors for Codex, Claude Code, and Claude Cowork and
installs the same Ask Apero skill for Codex and Claude Code. Restart the agent
after setup. If Cowork does not discover the descriptor, add
`.cowork/maestro-brain.json` through its connector UI.

Confirm the canonical evidence path before normal use:

```bash
maestro-brain mcp tools
maestro-brain evidence search "What is our ICP?"
maestro-brain evidence source-get <source-key> <revision-key>
```

The API key remains in the user's local Maestro Brain configuration. Generated
project descriptors refer to `MAESTRO_BRAIN_API_KEY`; they do not contain its
value. Each teammate links the shared workspace with their own credential.
