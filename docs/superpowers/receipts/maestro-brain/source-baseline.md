# Maestro Brain Source Baseline Receipt

- **Task:** S00-T02 — Freeze Sources, Register Gaps, And Prove Stack Receipts
- **Verification date:** 2026-07-14
- **Repository HEAD at verification:**
  `9e478a1a2377677973f33726db6d77353f9c9d15`
- **Implementation base ancestry:**
  `git merge-base --is-ancestor 123adb18c0abfe81fe98dd531c910b6cf493c8dd HEAD`
  exited `0`.
- **Customer/provider data:** none recorded.

## Resolved source pins

Each pin was resolved with a temporary clone outside the repository using
`git fetch --depth=1 origin <sha>`, `git cat-file -t <sha>`, and
`git rev-parse <sha>^{commit}`. Temporary clones were deleted after recording
this receipt.

| Source                      | URL                                                                 | Pinned revision                            | Resolution                 |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------ | -------------------------- |
| SaaS UI template            | `https://github.com/modernagencysales/maestro-template-saas-ui.git` | `123adb18c0abfe81fe98dd531c910b6cf493c8dd` | `commit`, resolved exactly |
| Maestro                     | `https://github.com/modernagencysales/maestro.git`                  | `c8b644c154af91f7e6b67b31861fd6b7eaa211b1` | `commit`, resolved exactly |
| Nango                       | `https://github.com/NangoHQ/nango.git`                              | `0bef47367085384c037a0ccca83c7d5bfc696d7f` | `commit`, resolved exactly |
| Nango integration templates | `https://github.com/NangoHQ/integration-templates.git`              | `e286bd20c5795f9e8bfbc9053e65669941c08c89` | `commit`, resolved exactly |
| Vercel AI SDK Slackbot      | `https://github.com/vercel-labs/ai-sdk-slackbot.git`                | `7d84809865ba4624a38eab4dd6dbb2aecc3758bc` | `commit`, resolved exactly |
| Context OS                  | `https://github.com/jacob-dietle/context-os.git`                    | `b31051f5a7837c70b9e5d7b81f8a055801877741` | `commit`, resolved exactly |

## Anchor review

- `tooling/stack/plan.mts` still enforces classified `workPackages`, non-empty
  `followUpGates`, `MAX_EST_LINES = 300`, `MAX_DEPTH = 4`, task coverage, and
  contract-risk validation.
- `docs/template/porting-backlog.md` now registers the Maestro Brain pattern gap
  IDs and their promotion/import paths.
- No source pin drift or anchor/design disagreement was found.
