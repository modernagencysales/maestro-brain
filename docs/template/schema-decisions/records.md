# Records Schema Decision

Canonical system: `record-management`  
Disposition: `introduce`  
Status: additive

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `internal`
- PII categories: none
- Export: `json`
- Delete/redaction: `delete`
- Retention: `retain-until-workspace-delete`
- Append-only: `false`
- Write authority: `packages/convex/confect/records/records.spec.ts`

The table is new and requires no backfill. Rollback removes callers before the
table and preserves workspace isolation throughout the compatibility window.
