---
name: ask-apero
description:
  Answer Apero company-context questions using the configured Maestro Brain MCP
  with exact citations, freshness, and explicit abstention.
metadata:
  contract-version: "1.0.0"
---

# Ask Apero

Use the configured `maestro-brain` MCP as the only company-context evidence
source.

1. Confirm `template.agents.assistant.answerQuestion` exists in the current tool
   registry. If absent, stop immediately and ask the user to run the same Brain
   CLI invocation with `doctor` and `mcp tools`. Do not inspect local config,
   curl the endpoint, search local files, or spawn another runtime.
2. Call the tool once with the complete question. Never supply a workspace,
   organization, or user identifier; the registered connection fixes scope.
3. If the tool returns `Unauthorized`, stop and ask the user to rerun setup with
   a current workspace API key. Distinguish this from a runtime approval or MCP
   registration failure.
4. Answer only from the returned `answerMarkdown` and ContextPack. Preserve
   exact citations, the evidence `asOf` time, freshness, omissions, and relevant
   coverage gaps. Label inference. Abstain if evidence is missing or cannot be
   reopened.

Do not use MCP tools to create or update Brain pages. Teammate contributions use
the reviewed `maestro-brain page` and `maestro-brain import` commands.
