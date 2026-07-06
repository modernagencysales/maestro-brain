# Shift-Left Baseline

Generated: 2026-07-06.

This is the pre-adoption baseline for the shift-left planning work. It uses the
latest visible GitHub PR check rollup for the ten most recent PRs because that
is the local, reproducible source available without exporting Buildkite build
history. Treat it as the baseline for "latest visible PR attempt"; use the
Buildkite commands below when a strict first-push audit is needed.

## Current Sample

Command:

```bash
gh pr list --limit 10 --state all \
  --json number,title,state,createdAt,updatedAt,statusCheckRollup
```

Sample: PRs `#4` through `#13`.

| Slice                  | Result                                         |
| ---------------------- | ---------------------------------------------- |
| All ten latest PRs     | 9/10 latest visible rollups green (`90.0%`)    |
| Latest merged PRs only | 9/9 latest visible rollups green (`100.0%`)    |
| Current failure        | PR `#13`, Buildkite `#180`, failed `taste`     |
| Most recent green      | PR `#12`, Buildkite `#111`, all required green |

## Failure Ranking

| Gate    | Count | Evidence                                    |
| ------- | ----- | ------------------------------------------- |
| `taste` | 1     | PR `#13`, Buildkite `#180`, `taste` failed. |

No deterministic, contract-review, qlty, or Graphite failure appears in the
latest visible rollup sample.

## Push-To-Green

For merged PRs `#4` through `#12`, the median time from PR creation to the
Buildkite aggregate status timestamp in the GitHub rollup is approximately
`14m 28s`. This is a comparable local proxy, not a full queue-duration audit,
because GitHub exposes status timestamps rather than every historical push
attempt.

## Strict First-Push Refresh

Use Buildkite history when strict first-push rate is needed:

```bash
for n in 4 5 6 7 8 9 10 11 12 13; do
  gh pr view "$n" --json number,commits,statusCheckRollup
done

bk build view -p mas/maestro-template 111 --no-pager --text
bk build view -p mas/maestro-template 180 --no-pager --text
```

If the Buildkite organization is not configured for listing, direct build views
still work with the build numbers from GitHub status target URLs. Configure
`bk use mas` or use the Buildkite API to list all branch builds when auditing
multiple push attempts per PR.

## Pattern-Fit Refresh

Command:

```bash
pnpm pattern-fit
```

Current local fixture result:

```json
{
  "counts": {
    "fixture-to-real": 1,
    "pattern-instance": 5,
    "template-gap": 0
  },
  "patternFitPercent": "100.0%"
}
```
