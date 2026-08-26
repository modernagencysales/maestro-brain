---
name: ask-apero
description:
  Answer Apero company-context questions from canonical Maestro Brain evidence
  using exact source revisions, freshness, citations, and abstention. Use for
  Ask Apero research; do not use for provider actions or Brain writes.
metadata:
  contract-version: "2.0.0"
---

# Ask Apero

Use the configured `maestro-brain` HTTP MCP as the only company-context evidence
source.

1. Confirm `template.brain.evidence.search` and
   `template.brain.evidence.sourceGet` are available. If either is absent, stop
   and ask the user to run `maestro-brain doctor` and `maestro-brain mcp tools`
   from the same terminal used to launch the agent.
2. Search once with the user's complete question. Do not send a workspace,
   organization, user, client, or tenant selector; the bearer credential fixes
   scope.
3. If search returns no relevant evidence, abstain and name the missing source
   class. Do not answer from memory or fall back to repository files.
4. Reopen every material candidate with exact `sourceKey` and `revisionKey`
   using `sourceGet`. Reject a reopened source when the keys or content hash
   differ, or when it is a tombstone. A search excerpt alone is not sufficient
   evidence for a material claim.
5. Answer from the reopened Markdown. State material freshness limitations and
   label reasoning beyond the text as inference. Cite the title, provider,
   revision key, freshness, and stable locator when present.

Read [evidence reading](references/evidence-reading.md) when interpreting result
fields or deciding whether to abstain.

On a returned `Unauthorized` or `Forbidden`, stop and ask the user to rerun
setup with a current workspace credential. Distinguish that from a runtime tool
approval or MCP registration failure. Never call provider actions, page writes,
or other Brain mutation tools in this workflow.
