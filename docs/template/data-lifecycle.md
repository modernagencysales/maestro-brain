# Data Lifecycle

Every durable resource declares owner module, workspace scope, classification,
retention, export posture, delete posture, and demo-data eligibility.

## Export

Export requests produce scoped manifests. Manifests list resource owner, table
or provider, ids safe for the requester, file names, and omissions.

## Deletion

Deletion requests produce either typed block reasons or deletion receipts.
Blocks include legal hold, active billing dependency, active workflow run,
unsupported provider state, or missing authority.

## Data Map

The Data Map route shows resource owner, retention, export eligibility, delete
posture, provider storage, health, and module ownership.
