# Maestro Brain Capacity Harness

Status: synthetic product-instance harness for REL-02 and SLK-07. The template
gap is `TB-SOURCE-01`; after this instance, promote the deterministic
multi-tenant source-load pattern into the app factory.

## Launch Envelope

The frozen fixture is synthetic-only and contains no provider payloads or
customer text:

- 1 primary agency with an Agency Brain and 25 client Brains.
- 100 Slack channels: 75 Direct, 20 Classify, and 5 Capture-only.
- 100,000 source revisions.
- Live burst of 20 events/second for 60 seconds while backfill is active.
- 10 concurrent Ask/MCP requests.
- 1 lightweight adversarial canary agency for tenant-denial probes.

## Receipt Contract

`rtk pnpm --dir tooling/evals brain:capacity` emits a
`maestro-brain-capacity-report/v1` receipt with fixture, code, config, runner,
seed, hardware, latency, fairness, loss, queue, cost/storage, and tenant-denial
fields.

Passing requires:

- every runnable channel advances in each 60-second fairness window unless
  explicitly provider-rate blocked;
- no shared recent/deep cursor stalls;
- at least 95% of live events are visible within 60 seconds;
- all admitted events drain within five minutes;
- dropped events, queue overflow, attempt/effect mismatch, and tenant canary
  bypasses are zero.

Raising launch limits requires a new passing receipt. Rollback selects the last
passing capacity policy already enforced by the Slack/source workpool; exact
capture already admitted is never stopped.
