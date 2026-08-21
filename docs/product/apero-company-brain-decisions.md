# Apero Company Brain Pilot Decisions

**Status:** ready for owner completion

**Date:** 2026-08-21

This packet separates frozen technical decisions from the small set of business
inputs still required to begin the Apero pilot.

## Frozen Technical Decisions

| Decision           | Choice                                                               |
| ------------------ | -------------------------------------------------------------------- |
| Pilot boundary     | One trusted internal Apero agency Brain                              |
| First value        | Approved Claude snapshot imported as dated, reviewed Brain pages     |
| Raw evidence       | Preserve existing provider-specific ledgers                          |
| Retrieval boundary | Derived Brain-scoped `retrievalEntries` plus token postings          |
| Search             | Deterministic lexical retrieval; no vectors in the pilot             |
| Answer synthesis   | Codex/Claude synthesize from typed ContextPack                       |
| Live-source order  | One document source first; structured source only from measured gaps |
| Tool policy        | Brain MCP read-only; provider actions post-pilot                     |
| Granular ACLs      | Deferred; selected containers are shared with the trusted cohort     |

These choices do not require another architecture review unless repository
evidence proves the projection cannot be implemented.

## Required Owner Inputs

Complete before the associated work-package gate, not necessarily before all
engineering begins.

| Input                          | Owner           | Value                                        | Needed by |
| ------------------------------ | --------------- | -------------------------------------------- | --------- |
| Context/business owner         | TBD             | TBD                                          | WP00      |
| Engineering DRI                | TBD             | TBD                                          | WP01      |
| Active agency Brain key        | Engineering DRI | TBD                                          | WP02A     |
| First two dogfood users        | Context owner   | TBD                                          | WP04      |
| Remaining three pilot users    | Context owner   | TBD                                          | WP09      |
| Claude Project access holder   | Context owner   | TBD                                          | WP00      |
| Restricted evaluation location | Context owner   | TBD                                          | WP01      |
| First document provider        | Context owner   | Shared Drive unless inventory says otherwise | WP05      |
| Dedicated test container       | Engineering DRI | TBD                                          | WP05      |
| Production container allowlist | Context owner   | TBD                                          | WP06      |
| Freshness targets              | Context owner   | TBD by source                                | WP06      |
| Structured source required?    | Context owner   | Decide from E0-E3 gaps                       | WP07      |

## Default Pilot Thresholds

Owners may amend these before the first frozen run:

- 10-20 E0 questions;
- at least 80% useful answers where required evidence exists;
- 100% citation-open success;
- zero invented citations;
- 100% controlled create/edit/move-or-unshare/delete convergence;
- median ContextPack retrieval at or below two seconds and p95 at or below five
  seconds, excluding model generation;
- every fallback to Claude records a reason.

## Start Authorization

WP00-WP01 may start immediately. WP02A may start as soon as the engineering DRI
and active agency Brain key are known. Snapshot review/import needs the context
owner and Claude Project access. Drive adapter work needs only the frozen WP02A
publication contract and a dedicated provider test container.
