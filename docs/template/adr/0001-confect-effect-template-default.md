# ADR 0001: Confect And Effect As Template Contract Default

Date: 2026-07-01

## Status

Accepted.

## Context

The template needs stronger end-to-end type safety than plain Convex validators
alone provide. It also needs to preserve Convex components and the existing
workflow/capability/agent architecture.

## Decision

Use Confect and Effect as the default contract layer for new template backend
functions, HTTP APIs, generated refs, typed errors, and service layers. Keep
plain Convex functions where Convex components require them, but register those
functions through the Confect spec/impl tree.

## Consequences

- The template gets typed args, returns, expected errors, generated refs, and
  stronger AI-agent coding constraints.
- The repo must pin compatible Confect and Effect versions.
- The repo must add contract gates so generated refs, special Confect
  entrypoints, and plain Convex interop stay correct.
