# Capability Authoring Guide

Capabilities are the safe unit of business action. They authenticate, validate,
delegate, and return typed results.

## Capability Contract

Each capability declares:

- name and description;
- args schema;
- returns schema;
- typed expected errors;
- auth policy;
- cost policy;
- idempotency policy;
- rate-limit policy;
- audit policy;
- headless exposure;
- example fixture.

## Runtime-Authored Capabilities

Runtime-authored capabilities are stored data, not arbitrary code. They support
constrained schemas, policy validation, activation, version pinning, rollback,
fixture tests, and promotion to generated Confect source when compile-time
safety is required.

## Verification

```bash
pnpm --dir packages/convex test capabilities
pnpm --dir apps/web test src/features/capabilities
pnpm check:confect-contracts
```
