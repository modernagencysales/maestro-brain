# Security Review Guide

Review security-sensitive changes for:

- tenant identity derivation;
- auth and role boundaries;
- webhook signature and replay handling;
- API key hashing, display-once behavior, and revocation;
- provider SDK isolation;
- secret and payload redaction;
- storage URL expiry and scope;
- support access auditability;
- destructive action confirmation;
- prompt-injection resistance;
- generated-file discipline.

Every finding should include the affected file, risk, exploit path, and the
smallest test or gate that prevents recurrence.
