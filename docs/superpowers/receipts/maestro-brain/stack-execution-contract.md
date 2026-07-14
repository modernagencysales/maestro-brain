# Maestro Brain Stack Execution Contract Receipt

- **Task:** S00-T02 — Freeze Sources, Register Gaps, And Prove Stack Receipts
- **Verification date:** 2026-07-14
- **Temporary manifest location:** outside the repository under
  `/tmp/s00-t02-stack.*`; deleted after this receipt.
- **Customer/provider data:** none recorded.

## StackPlan contract

A StackPlan is valid only when `rtk pnpm stack:check <absolute-temp-plan.json>`
passes against the current checkout. Required top-level fields are `feature`,
`slices`, and `allTaskRefs`. Required slice fields are `id`, `branch`,
`intention`, `layers`, `contractRiskIds`, `workPackages`, `taskRefs`,
`rationale`, and `estLines`.

Every `workPackages[]` entry declares exactly one classification:
`fixture-to-real`, `pattern-instance`, or `template-gap`. It must include a
non-empty `target` and non-empty `followUpGates`; kind-specific metadata records
the fixture/provider boundary, generator command, or backlog reference and
promotion path.

Source-line review is split, not waived. Receipts report hand-authored source
lines separately from generated output, tests, and documentation review totals.
`estLines > 300` or stack depth greater than four fails before implementation;
the remedy is to split the stack, not to waive the cap.

## Adversarial fail/pass transcript

| Trial                                | Temporary manifest SHA-256                                         | Expected result | Observed result                                                                    |
| ------------------------------------ | ------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------- |
| Missing `workPackages.followUpGates` | `7ed13523bcbb3900c557918b17aed4bca0157c071dc00f682916b30357b31ba7` | reject          | `slice 2 workPackages[0].followUpGates must be a non-empty string array`; exit `1` |
| `estLines: 301`                      | `ae5f3599e925191fd26e80026465ef4fd95b859f8a88396a9b9bd56ce67057a4` | reject          | `slice 2 estLines 301 exceeds 300`; exit `1`                                       |
| Fifth slice                          | `5ff96674250e5f7f6432ba2b47fd2fb9c2f504a636790de27a4fa3ed69619498` | reject          | `stack depth 5 exceeds MAX_DEPTH 4`; exit `1`                                      |
| Corrected S00 projection             | `bfe3f1a960a02dad83c6818dc0e4dad4d6f7551c2d01177b76a50421b6f60df8` | pass            | `✓ stack plan valid`; exit `0`                                                     |

Corrected projection depth: `4` slices. Corrected source estimates: S00-T01
`40`, S00-T02 `120`, S00-T03 `260`, S00-T04 `280`; each is within the 300-line
planning cap. The corrected manifest covered `S00-T01`, `S00-T02`, `S00-T03`,
and `S00-T04` and was deleted after hashing.

## Gap IDs and promotion paths

The following IDs are registered in `docs/template/porting-backlog.md` with
absence, generic lesson, first product implementation path, promotion criteria,
owner, and focused gates:

- `TB-DEVEX-CONVEX-01`
- `TB-AUTHKIT-01`
- `TB-BRAIN-UI-01`
- `TB-NANGO-SLACK-01`
- `TB-SOURCE-01`
- `TB-SOURCE-LIFECYCLE-01`
- `TB-AUTHORIZED-KNOWLEDGE-01`
- `TB-STRUCTURED-LLM-01`
- `TB-INTERNAL-WORKFLOW-01`
- `TB-ASYNC-SEARCH-01`
- `TB-HEADLESS-01`
- `TB-BRAIN-EXPORT-01`
- `TB-DEPLOY-ISOLATION-01`
- `TB-AUTHORIZED-TENANCY-01`
- `TB-ACCESS-UI-01`
- `TB-EVALS-01`
- `TB-OPERATIONS-01`
- `TB-RELEASE-EVIDENCE-01`
