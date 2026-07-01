# Client Fork Upgrade Guide

Client forks should upgrade from tagged template releases.

## Upgrade Flow

1. Read the template changelog.
2. Run
   `pnpm template:upgrade -- --from <client-version> --to <template-version>`.
3. Review changed packages, env vars, migrations, generated contract diffs, and
   manual review items.
4. Apply migrations in staging.
5. Run fake and live-provider smokes.
6. Promote only from the verified commit.

## Conflict Policy

Client-specific code belongs in extension packages. If a fork changed template
core files, convert those changes into extension seams before upgrading.

## Command Output

`template:upgrade` emits a JSON report with:

- changed packages;
- environment changes;
- migration review items;
- generated contract diffs;
- manual review checklist;
- commands to run before promotion.
