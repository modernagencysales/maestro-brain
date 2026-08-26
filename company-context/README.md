# Apero Company Context Package

This directory is the reviewed onboarding and agent-behavior package for Apero's
shared Maestro Brain. It is not the live knowledge store.

- [`install.md`](./install.md) connects a terminal-first Codex, Claude Code, or
  Claude Cowork project.
- [`skills/ask-apero`](./skills/ask-apero/SKILL.md) defines the canonical
  read-only evidence workflow.

Keep credentials, synced provider bodies, CRM exports, email, contracts, and
client data out of this directory. Live content belongs in the workspace Brain
and is read through canonical evidence search and exact source retrieval.

The release CLI packages a byte-equivalent copy of the skill under
`apps/brain-cli/assets/ask-apero` so setup works without a repository checkout.
