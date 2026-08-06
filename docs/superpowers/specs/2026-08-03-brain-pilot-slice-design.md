# Maestro Brain pilot slice

## Outcome

Ship the smallest useful internal pilot: an authenticated workspace can review
source-backed Brain content, publish it into a Brain page, edit that page, and
search/ask against published content with citations.

## Scope

- Reuse the existing WorkOS-shaped identity and workspace authorization seams.
- Support one trusted source path first: pasted Markdown/notes submitted by an
  authorized editor. Slack ingestion remains the next increment.
- Persist source, review state, published page content, and citation metadata in
  the existing Convex/Confect patterns.
- Provide one Brain workspace route with loading, empty, ready, edit, mutation
  success, and mutation failure states.
- Provide deterministic keyword search over published content and cited Ask
  results; no vector database or model-generated answer is required for this
  pilot.

## Explicitly deferred

Slack OAuth/events, full lifecycle/DSAR, private Slack answers, MCP/export,
multi-source ingestion, capacity dashboards, and factory/Fabro orchestration.

## Design constraints

- Preserve tenant isolation and server-derived authorization.
- Keep generated files and vendored `repos/` untouched.
- Make each product change test-first and landable as a small commit.
- Use the repository's pinned pnpm version and existing route, Confect, Convex,
  and UI conventions.

## Acceptance

An authorized editor can submit a note, see it awaiting review, approve it,
publish it to a Brain page, edit the page, search for a term, and receive a
result containing the matching text and source citation. Unauthorized access,
empty state, loading state, and failed mutations have explicit behavior tests.
