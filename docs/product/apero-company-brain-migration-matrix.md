# Apero Company Brain Migration Matrix

**Status:** ready for inventory

**Date:** 2026-08-21

Use this matrix during WP00. Do not paste sensitive source bodies or credentials
into this file. Record names, locations, owners, and migration decisions only.

## Claude Project Inventory

| Current asset/workflow        | Current location            | Authority                                 | Destination                                                | Owner | Evaluation layer | Pilot required? | Status/notes        |
| ----------------------------- | --------------------------- | ----------------------------------------- | ---------------------------------------------------------- | ----- | ---------------- | --------------- | ------------------- |
| Project instructions          | Claude Project              | TBD                                       | Dated Brain-page snapshot plus reviewed policy destination | TBD   | E0               | Yes             | Inventory required  |
| Uploaded knowledge files      | Claude Project              | TBD                                       | Dated Brain-page snapshot; long-term source per row        | TBD   | E0/E1            | TBD             | Inventory required  |
| Recurring Ask Apero questions | User workflow               | Authoritative evidence named per question | Restricted evaluation set                                  | TBD   | E0-E3            | Yes             | Capture 10-20 first |
| Tool-dependent workflows      | Claude Project/user process | Provider system                           | Agent tool bundle, post-read-pilot unless required         | TBD   | E3               | TBD             | Inventory required  |

Add one row per material instruction, file group, recurring workflow, or known
gap. Split a row when two items have different authorities or destinations.

## Evaluation Question Register

Keep confidential question text in the restricted evaluation location. This file
stores only its opaque identifier and evaluation metadata.

| Question ID | Layer | Required corpus/source         | Required evidence | Expected behavior                     | Owner | Included?   |
| ----------- | ----- | ------------------------------ | ----------------- | ------------------------------------- | ----- | ----------- |
| E0-001      | E0    | Brain-page snapshot            | TBD               | Answer with exact citation or abstain | TBD   | Yes         |
| E0-002      | E0    | Slack                          | TBD               | Answer with exact citation or abstain | TBD   | Yes         |
| E0-003      | E0    | Transcript                     | TBD               | Answer with exact citation or abstain | TBD   | Yes         |
| E1-001      | E1    | First document source          | TBD               | Answer with exact citation or abstain | TBD   | Later       |
| E2-001      | E2    | Structured source if justified | TBD               | Return current typed fact and locator | TBD   | Conditional |

## Source Coverage Register

| Source/corpus         | Discovered | Observed | Normalized | Published | Failed | Stale | Receipt/version |
| --------------------- | ---------- | -------- | ---------- | --------- | ------ | ----- | --------------- |
| Reviewed Brain pages  | TBD        | TBD      | TBD        | TBD       | TBD    | TBD   | TBD             |
| Slack                 | TBD        | TBD      | TBD        | TBD       | TBD    | TBD   | TBD             |
| Transcripts           | TBD        | TBD      | TBD        | TBD       | TBD    | TBD   | TBD             |
| First document source | TBD        | TBD      | TBD        | TBD       | TBD    | TBD   | TBD             |
| Structured source     | TBD        | TBD      | TBD        | TBD       | TBD    | TBD   | Conditional     |

## Completion Rule

WP00 exits when the primary Ask Apero user confirms that every material current
asset or workflow is migrated, deliberately excluded, or recorded as a named gap
with an owner and destination.
