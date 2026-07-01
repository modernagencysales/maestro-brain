# Extraction And Redaction Guide

Use this guide when porting reusable code from Maestro or another private app.

## Rules

- Copy the smallest generic primitive.
- Rename product-specific nouns before commit.
- Replace examples with synthetic data.
- Do not copy prompts, transcripts, screenshots, raw provider payloads, launch
  copy, investor notes, secrets, or support artifacts.
- Update the fixture manifest before adding fixture classes.

## Scan

```bash
rg -n "Maestro|LinkedIn|client transcript|investor|secret|api key|webhook payload|real client|launch copy|support artifact" .
git diff --check
```

Matches are allowed only in extraction policy docs unless explicitly approved.
