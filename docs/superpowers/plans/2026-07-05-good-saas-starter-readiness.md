# Good SaaS Starter Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current Notion Kit reference app and docs read as a coherent
B2B SaaS starter with an obvious Day-0 factory loop.

**Architecture:** Keep TanStack Start, Notion Kit, and the existing sample app.
Add starter-readiness view-model data to the sample app, render it through the
existing document page layer, and align quickstart/maturity/backlog docs with
actual command behavior.

**Tech Stack:** React, TanStack Start, Notion Kit via `@maestro-template/ui`,
Vitest, Markdown docs, existing generator/release tooling.

---

## File Structure

- `apps/web/src/sample/templateData.ts`
  - Add typed starter readiness data: statuses, Day-0 commands, proof points.
- `apps/web/src/sample/sampleDocumentData.ts`
  - Render starter readiness sections on the Overview page.
- `apps/web/src/sample/templateData.test.ts`
  - Prove starter readiness data, command order, and proof points stay present.
- `docs/template/quickstart.md`
  - Clarify that `template:quickstart -- --write` writes
    `template-instance.json`, and `template:doctor` expects that file.
- `docs/template/template-maturity-model.md`
  - Describe current L0-L4 baseline honestly and reserve L5 for client forks.
- `docs/template/porting-backlog.md`
  - Add an authority note explaining that the backlog is historical inventory
    and may lag current implementation status.
- `docs/superpowers/specs/2026-07-05-good-saas-starter-readiness-design.md`
  - Design target for this slice.

## Task 1: Starter Readiness Sample Data

**Files:**

- Modify: `apps/web/src/sample/templateData.ts`
- Test: `apps/web/src/sample/templateData.test.ts`

- [ ] **Step 1: Write the failing test**

Add imports and a test:

```ts
import { starterReadiness } from "./templateData";

it("documents the Day-0 SaaS starter loop", () => {
  expect(starterReadiness.statuses.map((status) => status.label)).toEqual([
    "Hosted reference app",
    "Fake provider mode",
    "Generated headless surfaces",
    "Client fork packet",
    "Live provider setup",
  ]);
  expect(starterReadiness.dayZeroCommands).toEqual([
    'pnpm template:quickstart -- --blueprint source-grounded-gtm-brain --name "Client Brain" --write',
    "pnpm template:doctor -- --mode fake",
    "pnpm template:seed-demo -- --blueprint source-grounded-gtm-brain --write",
    "pnpm template:add-client-domain -- --name customerContext --write",
    "pnpm template:handoff -- --mode fake --write",
  ]);
  expect(starterReadiness.dayZeroCommands[0]).toContain("--write");
  expect(starterReadiness.proofPoints.map((point) => point.label)).toContain(
    "API / CLI / MCP registry",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir apps/web test -- src/sample/templateData.test.ts
```

Expected: FAIL because `starterReadiness` is not exported.

- [ ] **Step 3: Add the starter readiness data**

Add this export to `apps/web/src/sample/templateData.ts` near the other sample
data exports:

```ts
export type StarterReadinessStatus = {
  readonly label: string;
  readonly state: "ready" | "generated" | "client-specific";
  readonly detail: string;
};

export type StarterProofPoint = {
  readonly label: string;
  readonly detail: string;
};

export const starterReadiness = {
  statuses: [
    {
      label: "Hosted reference app",
      state: "ready",
      detail:
        "The Cloudflare Pages reference app and local static build smoke prove the shell can be hosted.",
    },
    {
      label: "Fake provider mode",
      state: "ready",
      detail:
        "WorkOS, PostHog, Dodo, email, LLM, and storage start in fake, console, or local mode.",
    },
    {
      label: "Generated headless surfaces",
      state: "ready",
      detail:
        "OpenAPI, Scalar docs, CLI commands, and MCP tools project from the generated Confect manifest.",
    },
    {
      label: "Client fork packet",
      state: "generated",
      detail:
        "The quickstart command writes the instance manifest, implementation brief, provider checklist, demo seed, and handoff packet.",
    },
    {
      label: "Live provider setup",
      state: "client-specific",
      detail:
        "Live credentials, legal posture, retention, and production smoke belong to the client fork.",
    },
  ] satisfies readonly StarterReadinessStatus[],
  dayZeroCommands: [
    'pnpm template:quickstart -- --blueprint source-grounded-gtm-brain --name "Client Brain" --write',
    "pnpm template:doctor -- --mode fake",
    "pnpm template:seed-demo -- --blueprint source-grounded-gtm-brain --write",
    "pnpm template:add-client-domain -- --name customerContext --write",
    "pnpm template:handoff -- --mode fake --write",
  ],
  proofPoints: [
    {
      label: "Brain and source context",
      detail:
        "Synthetic markdown, links, notes, and context packs show how client knowledge enters the app.",
    },
    {
      label: "Workflow graph and receipt",
      detail:
        "The durable workflow graph and trust receipt show how source-backed work is executed and audited.",
    },
    {
      label: "API / CLI / MCP registry",
      detail:
        "The same typed operation appears in API docs, CLI commands, MCP tools, and web routes.",
    },
    {
      label: "Provider posture",
      detail:
        "Fake/test/live-ready provider adapters make demos safe before live secrets are approved.",
    },
    {
      label: "Security and CI gates",
      detail:
        "Secret scanning, layer boundaries, Confect contracts, generated-file checks, and hosted smoke keep forks honest.",
    },
  ] satisfies readonly StarterProofPoint[],
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir apps/web test -- src/sample/templateData.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit after Task 2 or 3 when the first visible slice is green:

```bash
rtk git add apps/web/src/sample/templateData.ts apps/web/src/sample/templateData.test.ts
rtk git commit -m "feat: add starter readiness sample data"
```

## Task 2: Render Starter Console On Overview

**Files:**

- Modify: `apps/web/src/sample/sampleDocumentData.ts`
- Test: `apps/web/src/sample/templateData.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the template data test with:

```ts
import { overviewPage } from "./sampleDocumentData";

it("renders a starter console on the overview page", () => {
  const sectionText = overviewPage.sections
    .flatMap((section) => [section.heading, ...section.body])
    .join(" ");

  expect(sectionText).toContain("Starter console");
  expect(sectionText).toContain("Hosted reference app");
  expect(sectionText).toContain("pnpm template:quickstart");
  expect(sectionText).toContain("API / CLI / MCP registry");
  expect(sectionText).toContain("Live provider setup");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir apps/web test -- src/sample/templateData.test.ts
```

Expected: FAIL because the overview page does not include the starter console.

- [ ] **Step 3: Render starter readiness as document sections**

In `apps/web/src/sample/sampleDocumentData.ts`, import `starterReadiness` from
`./templateData`.

Add helper functions:

```ts
const starterStatusLines = starterReadiness.statuses.map(
  (status) => `**${status.label}** (${status.state}): ${status.detail}`,
);

const starterCommandLines = starterReadiness.dayZeroCommands.map(
  (command) => `\`${command}\``,
);

const starterProofLines = starterReadiness.proofPoints.map(
  (point) => `**${point.label}**: ${point.detail}`,
);
```

Add three sections near the top of `overviewPage.sections`:

```ts
{
  heading: "Starter console",
  body: [
    "This is the Day-0 control panel for a client SaaS fork: what is ready, what is generated, what is intentionally fake, and what must be client-specific before production.",
    ...starterStatusLines,
  ],
},
{
  heading: "Day-0 command loop",
  body: [
    "Run these commands in order. The first command uses `--write` because `template:doctor` checks the generated `template-instance.json` file.",
    ...starterCommandLines,
  ],
},
{
  heading: "Starter proof points",
  body: starterProofLines,
},
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir apps/web test -- src/sample/templateData.test.ts
```

Expected: PASS.

## Task 3: Align Quickstart And Maturity Docs

**Files:**

- Modify: `docs/template/quickstart.md`
- Modify: `docs/template/template-maturity-model.md`
- Modify: `docs/template/porting-backlog.md`
- Test: `tooling/quality/check-docs-freshness.test.mts`

- [ ] **Step 1: Write a failing docs freshness test**

Add an assertion to `tooling/quality/check-docs-freshness.test.mts` or the
descriptor fixture if the descriptor already owns markdown presence checks:

```ts
import { readFileSync } from "node:fs";

it("keeps starter quickstart and maturity docs aligned with the real command flow", () => {
  const quickstart = readFileSync("docs/template/quickstart.md", "utf8");
  const maturity = readFileSync(
    "docs/template/template-maturity-model.md",
    "utf8",
  );
  const backlog = readFileSync("docs/template/porting-backlog.md", "utf8");

  expect(quickstart).toContain(
    "`template:quickstart -- --write` creates `template-instance.json`",
  );
  expect(quickstart).toContain(
    "`template:doctor -- --mode fake` expects `template-instance.json`",
  );
  expect(maturity).toContain(
    "Current baseline: this repo can prove L0 through L4",
  );
  expect(maturity).toContain("L5 is client-fork-specific");
  expect(backlog).toContain(
    "Current readiness commands and the maturity model are authoritative",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir tooling/quality test -- check-docs-freshness.test.mts
```

Expected: FAIL because the docs do not yet contain the exact alignment text.

- [ ] **Step 3: Update `docs/template/quickstart.md`**

After the copy-paste command block, add:

```md
The first command must run with `--write`. `template:quickstart -- --write`
creates `template-instance.json`; `template:doctor -- --mode fake` expects
`template-instance.json` and will fail if you only previewed quickstart output.
Commands without `--write` are dry-run previews.
```

- [ ] **Step 4: Update `docs/template/template-maturity-model.md`**

After the opening paragraph, add:

```md
Current baseline: this repo can prove L0 through L4 with current source,
generated artifacts, hosted smoke tests, app-factory commands, and CI gates. L5
is client-fork-specific because it requires live provider credentials,
client-domain smoke, signed handoff evidence, and production operations.
```

- [ ] **Step 5: Update `docs/template/porting-backlog.md`**

After the existing execution note, add:

```md
Current readiness commands and the maturity model are authoritative for the
current template baseline. This backlog is a historical inventory of reusable
machinery and can lag recently merged implementation work; treat stale per-item
status text as backlog context, not readiness evidence.
```

- [ ] **Step 6: Run docs tests**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir tooling/quality test -- check-docs-freshness.test.mts
rtk host-test-slot --class focused pnpm check:docs-freshness
```

Expected: PASS.

## Task 4: Verification And Finish

**Files:**

- All modified files from Tasks 1-3.

- [ ] **Step 1: Run focused tests**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir apps/web test -- src/sample/templateData.test.ts
rtk host-test-slot --class focused pnpm --dir tooling/quality test -- check-docs-freshness.test.mts
rtk host-test-slot --class focused pnpm check:docs-freshness
rtk pnpm check:format
rtk git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run full verification**

Run:

```bash
rtk host-test-slot --class full pnpm verify
```

Expected: PASS.

- [ ] **Step 3: Commit any remaining changes**

Run:

```bash
rtk git status --short
rtk git add docs/superpowers/specs/2026-07-05-good-saas-starter-readiness-design.md docs/superpowers/plans/2026-07-05-good-saas-starter-readiness.md apps/web/src/sample/templateData.ts apps/web/src/sample/sampleDocumentData.ts apps/web/src/sample/templateData.test.ts docs/template/quickstart.md docs/template/template-maturity-model.md docs/template/porting-backlog.md tooling/quality/check-docs-freshness.test.mts
rtk git commit -m "feat: add starter readiness console"
```

Expected: clean commit.

- [ ] **Step 4: Push and open PR**

Run:

```bash
rtk git status --short --branch
rtk gh pr create --title "Add starter readiness console" --body "Adds a first-run SaaS starter console, aligns quickstart/maturity docs with the real Day-0 flow, and verifies starter readiness content."
```

Expected: PR created with green local verification evidence in the body.

## Self-Review

- Spec coverage: The plan covers starter console data, Overview rendering,
  quickstart command-order clarity, maturity/backlog truth alignment, focused
  tests, and full verification.
- Placeholder scan: No TBD/TODO/fill-in placeholders.
- Type consistency: `starterReadiness`, `StarterReadinessStatus`, and
  `StarterProofPoint` are introduced before use.
