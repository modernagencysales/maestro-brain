# Maestro Brain Operations

S13-T03 establishes the safe-operations seam for Maestro Brain. Operators get
redacted metrics, bounded admission checks, and independent kill switches
without customer text, prompts, Slack headers, provider tokens, or raw source
payloads.

## Metric Dictionary

All Brain metrics must contain only stable IDs, hashes, counts, durations,
status values, and error tags.

| Metric family             | Required safe fields                                                                         | Customer/provider fields forbidden                     |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Slack capture lag         | `workspaceId`, `connectionId`, `channelId`, `lagMs`, `status`, `errorTag`                    | event body, headers, bot/user tokens                   |
| Queue and lease health    | `workspaceId`, `subsystem`, `queueDepth`, `leaseCount`, `deadLetterCount`, `durationMs`      | job payloads, source text                              |
| Model and eval usage      | `workspaceId`, `brainKey`, `sourceHash`, `evalVersion`, `tokenCount`, `spendCents`, `status` | prompts, completions, model request/response bodies    |
| Search and Ask            | `workspaceId`, `brainKey`, `lagMs`, `count`, `status`, `errorTag`                            | query text, answer text, citation snippets             |
| Outbox, lifecycle, export | `workspaceId`, `brainKey`, `count`, `durationMs`, `storageBytes`, `status`, `errorTag`       | Slack message text, export contents, DSAR subject text |

`packages/observability/src/brainMetrics.ts` owns the reusable redaction and
budget helpers. Redaction canaries cover `prompt`, raw source, token, and header
fields recursively.

## Budgets

The admission helper reports typed `BudgetExceeded` results for:

- model token and spend caps;
- Slack rate caps;
- storage caps;
- queue-depth caps;
- channel-count caps.

Budget failures are metric/audit facts only: they include the budget name,
limit, and observed count, never the rejected payload.

## Kill Switches

Brain operation policy is subsystem-scoped data with owner, reason, expiry,
generation, and audit-ready state. The state machine is:

```text
enabled -> paused -> enabled
      \-> disabled
```

Emergency `disabled` is for operator-controlled stop conditions. Re-enabling a
stale generation returns `RecoveryGenerationMismatch`; running a disabled
subsystem returns `SubsystemDisabled`; stale or under-privileged operators
return `OperatorForbidden`.

Independent controls are mandatory:

- classification/model outage does not disable exact Slack capture;
- deep backfill throttle does not stop live capture;
- Ask, Slack delivery, MCP, export, lifecycle, maintenance, classification,
  backfill, and capture each have separate policy entries;
- lifecycle emergency revoke can stay disabled while publication surfaces remain
  paused rather than globally stopped.

Default external-risk posture remains conservative until launch enablement:
exact capture may stay enabled while semantic, delivery, headless, export, and
lifecycle execution surfaces are explicitly controlled.
