# Task 5 Slice C — Scheduler Frontier Report

## Audited current frontier

The current fixture contains 19 integrated/accepted tasks and three active green
lanes: `S04-T01`, `S04-T02`, and `S11-T02`.

Before Task 6, `registry_after_task6` is an effective serialized collision. The
active `S04-T02` migration owner therefore excludes all five ready tasks that
also own `packages/convex/confect/internal/migrations.ts`:

- `S02-T03`
- `S05-T01`
- `S07-T01`
- `S09-T02`
- `S10-T01`

The exact safe pre-Task-6 frontier is consequently six tasks:

```text
S03-T04 S06-T01 S08-T03 S08-T04 S13-T02 S13-T03
```

The earlier width-11 pre-Task-6 expectation was inconsistent with the collision
contract because it considered selected-owner conflicts but omitted effective
serialized collisions against active owners.

## Post-Task-6 frontier

After authoritative Task 6 registry evidence proves the fragment contract and
deterministic canonical generator are ready, the same fixture has width 11:

```text
S02-T03 S03-T04 S05-T01 S06-T01 S07-T01 S08-T03
S08-T04 S09-T02 S10-T01 S13-T02 S13-T03
```

`task6RegistryReady` remains false by default and is not enabled by production
dispatch. Task 5 Slice D / Task 6 integration must derive readiness from
authoritative registry evidence before setting it; caller assertion alone is not
release evidence.

## Repair evidence

- Active-owner checks use the effective serialized policy, including pre-Task-6
  `registry_after_task6`.
- Mandatory same-wave components are derived globally before filtering the
  active/eligible frontier, so blocked bridge nodes cannot split a component.
- Active owners count as preselected component members. With two available
  slots, the synthetic bridge fixture selects both remaining owners and emits
  the complete `[active, right, farRight]` integration group.
- Production dispatch loads the validated manifest projection and supplies
  explicit verified contract-artifact availability. Missing availability is
  fail-closed.
