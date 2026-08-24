# Saas UI alpha.9 paired visual evidence

Captured on 2026-08-24 from:

- pinned Starter `b76cb4514b9ab47f7db87901cb9b593b4adc3129` at the complete
  Contacts route;
- generated Maestro Brain from the canonical checkout at the complete Clients
  route, which is the same Contacts screen behind a product adapter.

`upstream-*` and `generated-*` are the paired desktop/mobile and light/dark
composition captures. `upstream-raw-*` retains the opaque loader defect present
in the exact upstream pin. The paired upstream composition captures remove only
that review-blocking overlay after the hydrated Contacts screen is present; no
layout or screen nodes are changed.

The 320 px keyboard pass found document widths of exactly 320 px for both
targets. Upstream focus order reached workspace, search, user menu, tabs, Add
person, Filter, and Display. Generated focus order reached workspace, search,
user menu, Connections, Brain, Clients, Invite people, and the content search.
Generated browser errors: zero. The upstream pin emitted its known React
state-update warning.
