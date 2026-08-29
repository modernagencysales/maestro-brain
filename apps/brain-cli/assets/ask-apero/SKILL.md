---
name: ask-apero
description:
  Answer Apero company-context questions through the canonical Maestro Brain
  ContextPack, preserving reviewed truth, exact citations, freshness, conflicts,
  omissions, and abstention. Use for Ask Apero research and decisions; do not
  use for provider actions or Brain writes.
metadata:
  contract-version: "3.0.0"
---

# Ask Apero

Use the configured `maestro-brain` HTTP MCP as the only company-context source.
Do not assemble an independent answer from search excerpts.

1. Confirm `template.brain.ask` and `template.brain.evidence.sourceGet` are
   available. If either is absent, stop and ask the user to run
   `maestro-brain doctor` and `maestro-brain mcp tools` from the same terminal
   used to launch the agent.
2. Call `template.brain.ask` once with the user's complete question. Use `mixed`
   unless the user explicitly requests only reviewed company truth or only
   recent evidence. Use high risk for pricing, economics, policy, contracts,
   responsibilities, staffing, or deal state. Never send a workspace,
   organization, user, client, or tenant selector; the bearer credential fixes
   scope.
3. Accept only ContextPack schema version `4`. Preserve its `packHash`, actual
   evidence mode, freshness, conflicts, omissions, answer status, and exact
   citation tuples. Never replace its answer with agent-authored company facts.
4. Reopen every material returned citation with its exact `sourceKey` and
   `revisionKey` using `sourceGet`. Reject the answer when a source is a
   tombstone or the reopened source/revision/content hash differs. A returned
   excerpt alone is not sufficient verification for a material claim.
5. Return the canonical `answerMarkdown` with concise numbered citations. Name
   relevant freshness limits, conflicts, and omissions. Include the pack hash
   when the user requests an audit trail. If the Brain returns
   `insufficient-context`, abstain and state its reason rather than answering
   from memory or repository files.

Read [evidence reading](references/evidence-reading.md) when interpreting result
fields or deciding whether to abstain.

Use `template.brain.evidence.search` only to diagnose an insufficient-context
result when the user asks why evidence was missed; it is not an alternate answer
path. On `Unauthorized` or `Forbidden`, stop and ask the user to rerun setup
with a current workspace credential. Distinguish that from a runtime tool
approval or MCP registration failure. Never call provider actions, page writes,
or other Brain mutation tools in this workflow.
