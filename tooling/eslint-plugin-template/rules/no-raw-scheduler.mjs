/**
 * no-raw-scheduler — orchestration has one door. A raw scheduler hop
 * (`ctx.scheduler.runAfter` / `ctx.scheduler.runAt`, on ANY receiver) is the
 * fire-and-forget escape hatch that smuggles a sequence past the workflow
 * journal: a chain of scheduled mutations carrying state IS a durable workflow
 * wearing a disguise, and a single fire-and-forget side effect belongs behind a
 * component-backed adapter (Convex components schedule INTERNALLY — a component
 * method call is NOT a `ctx.scheduler` hop, so it is untouched).
 *
 * SCOPE — files under packages/convex/confect/** (NOT tests). The thin
 * re-export shims under packages/convex/convex/** never touch a ctx and are
 * out of scope by design.
 *
 * WHAT IT FLAGS — a CALL whose callee is a member access `.runAfter` / `.runAt`
 * (non-computed) whose OBJECT is itself a member access `.scheduler` (non-
 * computed) on any receiver: `ctx.scheduler.runAfter(…)`,
 * `ctx.scheduler.runAt(…)`, `someCtx.scheduler.runAfter(…)`. The `.scheduler`
 * anchor is what makes this the SchedulerCtx hop and not, say, a `queue.runAt`
 * unrelated method — the receiver of `.scheduler` is unconstrained on purpose
 * (a destructured `{ scheduler }` is the rarer shape; the canonical hop is
 * `ctx.scheduler.run*`, and that is the one this gate closes).
 *
 * KNOWN BOUNDARY — value-aliasing the receiver is NOT tracked: a local
 * `const sch = ctx.scheduler; sch.runAfter(…)` slips, as does a dynamic computed
 * key `ctx.scheduler[name](…)`. Defeating these needs dataflow analysis the
 * repo's rules deliberately don't do. A static string-computed key
 * (`ctx["scheduler"]["runAfter"]`) IS caught; a local value-alias is a
 * documented edge, not a surprise.
 *
 * NOTE — unlike the upstream rule, `.spec.` files are NOT exempt here: in this
 * repo `*.spec.ts` files are confect function specs (production code), not tests.
 *
 * THE ALLOWLIST — per-file, root-anchored (`endsWith`), and STARTS EMPTY. There
 * is no legitimate direct scheduler hop in the repo. Widening it means editing
 * this file under review WITH a justification comment naming the exact file and
 * why a workflow/adapter cannot carry the effect — allowlist-as-code, no
 * per-project knob.
 */

// Root-anchored per-file exceptions. EMPTY by design: the repo has no direct
// scheduler hop. Each future entry needs a one-line justification above it
// naming why a workflow (sequence) or a component-backed adapter (single
// fire-and-forget) cannot carry the effect.
const ALLOW = [];

// The two scheduler methods that fire a deferred function. Matched by exact
// identity on the .runAfter/.runAt member, gated on a `.scheduler` object.
const SCHEDULER_METHODS = new Set(["runAfter", "runAt"]);

const CONVEX_RE = /(?:^|\/)packages\/convex\/confect\//;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "No raw scheduler hops (ctx.scheduler.runAfter/runAt) — sequences are durable workflows, single side effects go through component-backed adapters",
    },
    schema: [],
    messages: {
      rawScheduler:
        "Fire-and-forget side effects go through a component-backed adapter, not a raw scheduler hop — a sequence carrying state belongs in a durable workflow.",
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(
      /\\/g,
      "/",
    );
    if (!CONVEX_RE.test(filename)) return {};
    if (filename.includes(".test.") || filename.includes("/__tests__/")) {
      return {};
    }
    if (ALLOW.some((entry) => filename.endsWith(entry))) return {};

    return {
      // A call whose callee is `<obj>.scheduler.runAfter|runAt(...)`. The two
      // nested member accesses must both be non-computed (`["runAfter"]` and
      // `["scheduler"]` bracket forms are caught too — see below) so the
      // .scheduler anchor is real, not an unrelated `.runAt` method on a queue.
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (!isMember(callee, SCHEDULER_METHODS)) return;
        const object = callee.object;
        if (object.type !== "MemberExpression") return;
        if (!isMember(object, SCHEDULER_SET)) return;
        context.report({ node: callee, messageId: "rawScheduler" });
      },
    };
  },
};

// The `.scheduler` property name, as a single-element set so isMember can serve
// both checks (the method member and the scheduler member) with one helper.
const SCHEDULER_SET = new Set(["scheduler"]);

/**
 * True if `member` is a property access — `obj.name` or the string-computed
 * `obj["name"]` — whose accessed property is in `names`. A computed access with
 * a string literal key is the same access written differently, so it is NOT a
 * bypass; a dynamic computed key (`obj[expr]`) cannot be resolved statically and
 * is left to the type checker.
 */
function isMember(member, names) {
  if (!member.computed) {
    return (
      member.property.type === "Identifier" && names.has(member.property.name)
    );
  }
  return (
    member.property.type === "Literal" &&
    typeof member.property.value === "string" &&
    names.has(member.property.value)
  );
}
