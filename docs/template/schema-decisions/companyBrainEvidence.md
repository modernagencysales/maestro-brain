# Company Brain evidence data resources

The Company Brain adds six workspace-owned tables for provider-neutral evidence,
retrieval, and connector reconciliation. They are additive schema changes and do
not alter existing `brainPages` or `pageRevisions` rows.

`brainEvidenceRevisions` is immutable source history. `brainEvidenceSources`
holds the current revision pointer and removal state. `brainRetrievalEntries`
and `brainRetrievalTokens` are derived, bounded search projections updated in
the same mutation as a source revision. Retrieval projection version 2 stores
optional passage identity and exact character bounds on token postings. This is
additive: old token rows remain valid as whole-document candidates until the
bounded provisioning repair or the next source publication reprojects them. New
projections fail explicitly when the 48-passage/3,840-token per-entry capacity
is exceeded instead of silently truncating the source. `brainConnectorRuns` and
`brainConnectorRunSeen` record bounded full-traversal receipts so only a
successful complete run may infer removals.

Slack projection v1 adds optional `providerMetadataJson` and
`providerMetadataHash` to evidence sources and revisions. New Slack evidence is
normalized as deterministic, bounded thread segments (32 messages and 24,000
rendered characters maximum) with exact constituent-message offsets and
locators. The thread revision identity covers rendered content and provider
metadata; legacy evidence rows remain readable because both fields are optional.
Connector runs optionally bind the provider connection generation so revocation
or reauthorization prevents further publication and removal inference.
Reconciliation queries the run's exact scope rather than every source belonging
to the same provider.

Existing Brain pages are projected lazily through the bounded repair performed
during workspace provisioning. Provider evidence starts empty and is populated
only by an explicit successful sync. No deployment-time full-table migration is
required. Successful source upserts may advance independently. Failed or
capacity-exceeded connector runs never infer removals, and only a completed
bounded traversal may retire a source. Slack scheduled synchronization remains
disabled until an old-thread reply/edit/delete discovery strategy is proven; V1
uses explicit manual bounded synchronization.

All six resources are workspace lifecycle managed and are deleted with the
workspace. Evidence revisions and per-run observations are append-only;
current-source, retrieval, and connector-run state is mutable through the
Company Brain evidence implementation only.

Rollback may stop new projection writes while leaving the additive tables in
place. Removing the tables requires first disabling provider sync and retrieval,
then deleting the managed workspace data through the normal lifecycle path.
