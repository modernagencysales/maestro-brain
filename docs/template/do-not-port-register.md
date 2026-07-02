# Do-Not-Port Register

This template keeps Maestro's reusable architecture while excluding private
business logic, customer data, and production secrets.

## Prohibited Source Categories

- Maestro customer, client, prospect, or partner names.
- Real prompt bodies, system instructions, evaluator rubrics, and client
  strategy notes.
- Real provider payloads, webhook bodies, API responses, analytics exports, and
  production logs.
- LinkedIn harvesting, campaign, ghostwriting, lead-magnet, or other
  Maestro-specific GTM business logic.
- Sales-call transcripts, private notes, diligence notes, or internal client
  context.
- Production secrets, tokens, IDs, emails, webhook signing material, deployment
  identifiers, and billing identifiers.

## Allowed Transformations

- Rename domain concepts into generic Brain, workflow, capability, source,
  policy, receipt, provider, and tenant names.
- Replace fixtures with synthetic `acme-demo` or `example.test` data.
- Keep algorithms, safety mechanics, typed boundaries, tests, and UI primitives
  when they are domain-neutral.
- Rewrite plain Convex code into Confect/Effect contracts instead of copying it.
- Convert product-specific copy into neutral implementation guidance.

## Review Rule

If a source artifact cannot be safely explained in a client handoff packet, it
does not belong in the template. Create a synthetic fixture or a generic adapter
instead.
