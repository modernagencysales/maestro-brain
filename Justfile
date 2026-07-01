verify:
    rtk host-test-slot --class full pnpm verify

test-tooling:
    rtk pnpm test:tooling

test-workflow:
    rtk pnpm test:workflow

test-pr-backlog:
    rtk pnpm test:pr-backlog

evals:
    rtk pnpm evals

check-convex:
    rtk pnpm check:convex
