# Shift-Left Gate Enforcement Implementation Plan

Move gate enforcement earlier than lefthook — to spec/plan authoring — with the
**minimum** new machinery, by making generator invocations and
fixture-replacement checklists the medium of planning. CI should become
confirmation more often than discovery.

## Goal

The ~50 gate suite already catches most wrong shapes; the pain is loop length —
violations surface at CI (or, best case, pre-push). We want the same structural
rules present while the **spec/plan** is written, so work is right earlier.

Success is **not** "faster CI." It is **CI first-pass rate → ~1.0**, which takes
CI latency off the critical path while keeping the full suite as the trust
anchor.

## The core realization (why this is small)

Generators (`template:add-capability/workflow/agent`, `promote-*`,
`template:private-package:import`) emit **gate-correct scaffolds**, not finished
features. The shift-left move is therefore:

1. **Make the plan name the command or fixture path** that produces the work.
2. **Make the plan name the required follow-up gates** from the matching
   `how-to-add-*` playbook.
3. **Have the existing stack-plan validator reject missing fields.**

That is deliberately smaller than a parallel enforcement subsystem. We should
not build a new CI plan gate, rule-manifest projection, eval suite, or second
rule engine. But "plan = generator commands" still needs a tiny deterministic
shape check, and the repo already has one: extend `tooling/stack/plan.mts` /
`pnpm stack:check` rather than inventing `check-plan.mts`.

The rule becomes: **a plan is valid when every work-package is classified and
names either a generator command, an existing fixture-to-real target, or a
template-gap backlog item, plus the focused gates that must run before the next
slice.**

## Work decomposition vocabulary (the planning reframe)

On a template-based build, novel business content is not the axis for gate
placement. The gates check _shape_, and the template owns the reusable shapes.
Every unit of work is one of three kinds, and the plan states which:

- **`fixture-to-real`** — swap a contract-fixture body for real persistence /
  provider calls (`ops/*`, `agents`, `capabilities`, `jobs` per the AGENTS.md
  map). The spec, typed errors, and tests already exist and pin the contract;
  existing tests stay green, add persistence tests, and keep every declared
  typed failure reachable. This path does **not** need a generator command, but
  it must name the fixture module, the real persistence/provider boundary, and
  the focused tests/gates.
- **`pattern-instance`** — a new instance of a known kind via a `template:*`
  generator, then fill the body. The generator command is mandatory, and the
  plan also names the required follow-up commands (`pnpm confect:codegen`,
  `pnpm confect:manifest`, focused tests, and surface-specific gates).
- **`template-gap`** — genuinely off-pattern: no template kind fits. This is a
  **finding about the template**, not a waiver. Each gap is justified and routed
  to the template backlog (promote a pattern, or
  `template:private-package:import`). A high gap rate means the template is
  missing a pattern this vertical needs, or the vertical is a poor fit — either
  way, learned cheaply at plan time.

Each work-package records:

- `kind`: `fixture-to-real` | `pattern-instance` | `template-gap`
- `target`: fixture module, generated module name, or gap summary
- `generatorCommand`: required for `pattern-instance`; optional otherwise
- `followUpGates`: exact local commands from the relevant playbook
- `templateBacklogRef`: required for `template-gap`
- `templateResolutionPath`: required for `template-gap`
- `notes`: short implementation constraints, not copied rule text

**Pattern-fit** (share of work that is fixture-to-real + pattern-instance) is
the number that matters: it measures how much the template earned its keep and
whether the fork stays `template:upgrade`-able. It is a business signal, not a
code-quality nit.

## Scales to large / greenfield builds

A "whole thing" is a **tree** of plans → subplans → tasks (exactly your
`phase-10-*-subplan` structure). The planning check operates per
**subplan/work-package**, never "the whole app," so the touched surface stays
bounded no matter how big the build. maestro-template itself (~530 first-party
files, dozens of domains, built under this regime) is the existence proof; the
subplan hierarchy already carries it. Lean on the **structural/graph gates**
(which check structure, not size) over per-file `taste` (linear, and capped at
`MAX_FILES = 25`) as builds grow.

## Current State (Reused, Not Rebuilt)

- `scripts/pre-push-rubric.sh` — reads taste/contract rubrics from their
  source-of-truth files and injects them at pre-push for changed `apps/**` and
  `packages/**` TypeScript files. Backstop for code changes; **do not reuse it
  unchanged for plan writes**, because plan-only edits intentionally no-op.
- `tooling/stack/plan.mts` + `pnpm stack:check` — existing deterministic
  plan-shape validator. Extend this rather than introducing a separate
  `check-plan.mts`.
- `docs/rule-coverage.md` — rule→tier map; `review` is the weakest tier and the
  shift-left worklist.
- `tooling/generators/*` + the `how-to-add-*` playbook — the generator-backed
  starting point for planned work.
- `docs/template/app-factory-guide.md` — already states the generator flow and
  regeneration/focused-test steps.
- `lefthook.yml`, `check:gates`, `check:ci-completeness` — existing enforcement
  and meta-gates.

## Design invariants

1. **Projection, not duplication.** Guidance lives once (AGENTS.md + the
   generators + `rule-coverage.md`). The skill points at it; it never restates
   rules.
2. **Shape vs. enforce.** The skill _shapes_ (loads non-deterministically); the
   stack-plan validator checks required planning fields; generators + existing
   gates enforce code behavior. A skill is never treated as a gate.
3. **Scope to the touched surface** (per subplan, not per app).
4. **Self-review is not an independent gate** — the pinned CI judge stays as the
   adversarial backstop.
5. **Portable.** "Your plan classifies work and names the generator or fixture
   target plus follow-up gates" works for any agent or human; the skill/hook are
   Claude Code ergonomics over it.
6. **Measure or cut it.** Track CI first-pass rate and pattern-fit; if they
   don't move, delete the layer.

---

## Slice A: Planning Guidance + Tiny Shape Validation

### Task A.1: Add a "Planning on this template" section to AGENTS.md

- **Scope:** Document the decomposition vocabulary (fixture-to-real /
  pattern-instance / template-gap), the rule "express the plan as work-packages
  with generator/fixture/gap target + follow-up gates," and "a high template-gap
  rate is a template finding → backlog." Reference the existing fixture map,
  `docs/template/app-factory-guide.md`, and the `how-to-add-*` index; do not
  copy them.
- **Acceptance:** section merged; no rule text duplicated (links only).

### Task A.2: `planning` skill (thin pointer)

- **Files:** `.claude/skills/planning/SKILL.md` — frontmatter + "Use when
  drafting a plan/subplan here." Body: read the AGENTS.md planning section;
  decompose each work-package into fixture targets, `template:*` invocations, or
  template-gap backlog items under the subplan's **Files** section; classify
  each as fixture-to-real / pattern-instance / template-gap; dry-run generators
  when needed to enumerate files; copy exact focused gates from the matching
  `how-to-add-*` playbook.
- **Acceptance:** skill loads on a planning prompt; contains no rule copies.

### Task A.3: Extend stack-plan validation

- **Files:** `tooling/stack/plan.mts`, `tooling/stack/*.test.mts` or fixtures.
- **Scope:** Add required `workPackages` metadata to each new shift-left stack
  slice. If keeping legacy plan shape cleaner, put the same metadata in a
  sibling manifest that `stack:check` reads. Migrate checked-in fixtures in the
  same change rather than supporting two planning contracts. Validation rejects:
  - unknown `kind`;
  - `pattern-instance` without `generatorCommand` and `followUpGates`;
  - `fixture-to-real` without a fixture target and `followUpGates`;
  - `template-gap` without `templateBacklogRef` and a proposed promotion/import
    path;
  - empty focused gate lists.
- **Acceptance:** `pnpm stack:check <plan.json>` fails on adversarial fixtures
  for each missing field and passes a valid fixture. This is a plan-shape check,
  not a CI plan gate.

### Task A.4: Subplan template tweak + worked example

- **Scope:** In the plan/subplan template, note that **Files** is expressed as
  work-packages tagged with `kind`, `target`, optional `generatorCommand`, and
  `followUpGates`. Retrofit one existing subplan as the worked example.
- **Acceptance:** template/example updated; the matching stack-plan JSON fixture
  passes `pnpm stack:check`.

### Task A.5 (optional): plan-write hook

- **Files:** `.claude/settings.json` plus a plan-aware wrapper such as
  `scripts/plan-rubric.sh` or `tooling/quality/plan-rubric.mts`.
- **Scope:** Do **not** call `scripts/pre-push-rubric.sh` directly for plan
  writes: it filters to changed `apps/**` / `packages/**` TypeScript files and
  will usually no-op for `docs/superpowers/plans/**`. If this hook is worth
  having, make it print the planning checklist and source-of-truth
  taste/contract rubric links for changed plan files only.
- **Acceptance:** editing only a plan file surfaces plan-review output. Skip if
  A.1-A.4 prove sufficient in practice.

---

## Slice B: Measurement (a metric, not a gate)

### Task B.1: CI baseline

- **Files:** `docs/template/shift-left-baseline.md` — % of last-N PRs green in
  the latest visible check rollup, median proxy push-to-green, and failures
  ranked by gate. Include the strict first-push audit commands because the
  latest visible rollup is not the same as full Buildkite branch history.
- **Acceptance:** real numbers committed, caveated, and reproducible.

### Task B.2: Pattern-fit metric

- **Scope:** Add machine-readable provenance before measuring. Each generator
  writes a small generated metadata field/file with the generator name, command
  family, and generated paths. If a timestamp is useful, keep it in reporting
  output rather than in a committed file that creates noisy diffs. Then a
  reporting script counts `pattern-instance` + `fixture-to-real` work-packages
  versus `template-gap` work-packages. Avoid diffing against regenerated
  baselines until provenance exists; it will be noisy.
- **Files:** generator metadata output plus `scripts/pattern-fit.mts` (or fold
  into `template:doctor`).
- **Acceptance:** prints a % on the repo; no enforcement, reporting only.

### Task B.3: Re-measure after adoption

- **Scope:** recompute B.1 after a few real plans use Slice A; record the delta.
  This is the go/no-go for keeping the layer and for ever adding teeth.

---

## Deliberately NOT built (and why it's safe)

- **`check-plan.mts` / `plan-rules.ts` / plan frontmatter schema** — verified
  plan↔generator mapping as a new subsystem. Use the existing
  `tooling/stack/plan.mts` validator for required fields instead.
- **Rule-manifest projection (`rules.ts` → generated `rule-coverage.md`)** — a
  real improvement to source-of-truth hygiene, but orthogonal to shift-left;
  revisit only if `rule-coverage.md` drift becomes a measured problem.
- **A CI plan-gate / new eval fixtures** — no new required CI gate means nothing
  new to calibrate or register.
- **Making CI itself faster** — separate track; this makes CI failure _rare_,
  not _fast_.

## Risks & mitigations

| Risk                                  | Mitigation                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Off-pattern work slips past planning  | `pnpm stack:check` rejects missing generator/fixture/gap metadata; existing structural gates catch code issues at pre-push |
| Skill doesn't load / gets ignored     | Guidance also in always-on AGENTS.md; generators are the path of least resistance regardless                               |
| Guidance drifts from the real rules   | It links, never copies (Invariant 1)                                                                                       |
| Layer is pure ceremony                | Slice B gates its own survival                                                                                             |
| Template-gap becomes a dumping ground | `templateBacklogRef` is required; pattern-fit % is watched                                                                 |
| Plan-write hook silently no-ops       | Do not use `pre-push-rubric.sh` unchanged for plan files; either add a plan-aware wrapper or skip the hook                 |

## Success metrics

- **Primary:** CI first-pass rate ↑. Use the latest visible PR rollup as the
  initial proxy in B.1, then use strict Buildkite branch history when B.3
  re-measures after adoption.
- **Secondary:** pattern-fit % per build ↑; median push-to-green ↓; rules
  resting on the `review` tier in `rule-coverage.md` ↓.

## Decisions for this implementation

1. Build A.1-A.4 now. This is the smallest useful enforcement change because
   `pnpm stack:check` can reject incomplete work-package metadata without adding
   another gate.
2. Build B.1-B.2 now as reporting only. The baseline and pattern-fit script are
   useful for deciding whether the layer earns its keep, but they do not block
   CI.
3. Skip A.5 for now. Add a plan-write hook only if real planning edits keep
   missing the work-package rubric.
4. Leave B.3 for post-adoption measurement. It cannot be completed until a few
   real plans have used Slice A.
5. Treat AGENTS.md plus the `planning` skill as enough for now; add projections
   for other agents only if they miss the AGENTS.md guidance in practice.
