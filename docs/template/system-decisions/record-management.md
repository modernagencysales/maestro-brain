# Record Management System Decision

The SaaS application blueprint introduces `record-management` because no base
template system owns generic customer business records. The system owns one
workspace-scoped `records` table, its Confect CRUD contract, and the records
route. It reuses `access-and-tenancy` for workspace authorization.

Keep this system when the starter noun is renamed. Extend it for adjacent CRUD
behavior; introduce another system only when the new behavior has genuinely
independent authority and lifecycle.
