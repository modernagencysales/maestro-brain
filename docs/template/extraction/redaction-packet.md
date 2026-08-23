# Redaction Packet

The template extraction fails if any copied file contains private Maestro
prompts, real client names, transcripts, screenshots, source excerpts, launch
copy, investor notes, secrets, API keys, webhook payloads, support artifacts, or
unapproved fixture data.

This packet applies to source files, docs, tests, examples, generated artifacts,
seed data, screenshots, browser recordings, API examples, emails, webhook
fixtures, and provider payload fixtures.

## Hard Exclusions

- Private Maestro prompts and prompt fragments.
- Real client, prospect, investor, partner, employee, or call participant names
  unless they appear only in public package metadata or repository ownership.
- Real transcripts, call notes, source excerpts, URLs, screenshots, recordings,
  audio, video, or exported customer data.
- Launch copy, GTM drafts, diligence notes, pricing experiments, and
  investor-sensitive strategy documents.
- Secrets, API keys, OAuth tokens, webhook signing secrets, raw webhook
  payloads, support artifacts, provider request/response logs, and production
  stack traces.
- Unapproved fixture data, including fixtures derived from real customer or
  launch artifacts even when lightly edited.

## Reviewer-Safe Demo Data Rule

Every fixture must be synthetic, redacted, or explicitly approved for template
use. Synthetic data should use fictional workspaces, fictional people, fictional
providers, fake ids, fake domains, fake timestamps, and fake billing events. If
the provenance of a fixture is unclear, it is rejected until proven safe.

## Extraction Procedure

1. Copy only the smallest reusable primitive needed for the template task.
2. Rename product-specific nouns into generic nouns before committing.
3. Replace all examples with synthetic names and fake provider payloads.
4. Run the redaction scan before every commit that copies docs, examples,
   prompts, tests, source fixtures, screenshots, or provider payloads.
5. Record any approved exception in `fixture-manifest.md` with owner, source,
   approval note, and deletion/export posture.

## Redaction Scan

Run this from the template repo before committing extraction work:

```bash
rtk rg -n "Maestro|LinkedIn|client transcript|investor|secret|api key|webhook payload|real client|launch copy|support artifact" .
rtk git diff --check
```

Matches inside this extraction packet and source inventory are allowed only
because they describe prohibited content. Matches in fixtures, examples, app
copy, source code, prompts, or docs intended for reviewers must be removed or
explicitly approved.
