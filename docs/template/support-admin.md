# Support And Admin

Admin and support tools are narrow operator surfaces over audited capabilities.

## Support Can Inspect

- organization;
- workspace;
- workflow run;
- billing state;
- support incident;
- provider health;
- audit events.

## Support Cannot

- bypass workspace boundaries;
- read raw secrets;
- mutate customer data without a specific capability;
- impersonate without an audited policy;
- access review-token scopes outside the token grant.

Every support action records actor, reason, scope, timestamp, and result.
