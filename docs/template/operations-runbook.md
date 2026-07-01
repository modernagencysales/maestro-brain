# Operations Runbook

## Deploy

1. Run deterministic verification.
2. Run provider fake smokes.
3. Run `pnpm build` and `pnpm smoke:web-static`.
4. Deploy staging from the exact commit.
5. Run `pnpm smoke:hosted` or the provider-specific deploy smoke.
6. Promote production through the human approval block.

## Rollback

1. Identify the last staged commit with passing deploy smoke.
2. Validate schema compatibility and generated contract diffs.
3. Run rollback validation.
4. Promote the rollback commit.
5. Record incident notes and follow-up tests.

## Provider Outage

1. Enable the relevant kill switch or fake fallback.
2. Confirm user-facing typed failure states.
3. Audit queued jobs and retries.
4. Reconcile provider state after recovery.

## Incident

1. Classify severity.
2. Freeze risky deploys.
3. Preserve logs without exposing secrets.
4. Notify affected operators.
5. Write the remediation and regression-test plan.

## Support Access

Support access requires role authority, reason, scoped resource, audit event,
and expiry.

## Billing Reconciliation

Reconcile provider ledger events, local credit ledger, webhook idempotency, and
manual adjustments.

## Data Export And Delete

Use the data lifecycle capabilities. Do not manually query or delete customer
data outside audited flows.

## Backup And Restore

Run restore drills in fake or staging mode before production reliance.
