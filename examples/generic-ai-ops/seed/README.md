# Generic AI Ops Seed Fixtures

These fixtures are synthetic reviewer-safe data for a provisioned client fork.
They are not exported from Maestro and are not customer data.

The template does not ship a live Convex deployment. A client fork should insert
`workspace.json` first, then map the returned Convex workspace id into any Brain
pages or workflow runs that reference `workspaceRef`.
