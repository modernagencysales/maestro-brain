import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDirectRun } from "./src/direct-run.mts";

export type AccessAuditEventFinding = {
  readonly file: string;
  readonly message: string;
};

export type AccessAuditEventResult = {
  readonly ok: boolean;
  readonly findings: readonly AccessAuditEventFinding[];
};

const accessImplFiles = [
  "packages/convex/confect/access/members.impl.ts",
  "packages/convex/confect/access/invitations.impl.ts",
] as const;

const eventProducingPlannersByFile = {
  "packages/convex/confect/access/members.impl.ts": [
    "changeMemberRole",
    "removeMember",
    "transferOwnership",
  ],
  "packages/convex/confect/access/invitations.impl.ts": [
    "buildInvitationCreatedEvent",
    "acceptInvitation",
    "declineInvitation",
    "cancelInvitation",
  ],
} as const satisfies Record<
  (typeof accessImplFiles)[number],
  readonly string[]
>;

export function evaluateAccessAuditEventSource(
  file: (typeof accessImplFiles)[number],
  source: string,
): readonly AccessAuditEventFinding[] {
  const findings: AccessAuditEventFinding[] = [];
  const planners = eventProducingPlannersByFile[file];

  for (const planner of planners) {
    if (!source.includes(planner)) {
      findings.push({
        file,
        message: `${file} no longer references access lifecycle planner ${planner}. Update check:access-audit-events for the new boundary.`,
      });
    }
  }

  if (!source.includes("acknowledgeAccessLifecycleEvents")) {
    findings.push({
      file,
      message: `${file} must explicitly acknowledge access lifecycle events until the durable audit sink is wired.`,
    });
  }

  if (!source.includes('"audit-sink-not-yet-implemented"')) {
    findings.push({
      file,
      message: `${file} must label temporary audit acknowledgement with audit-sink-not-yet-implemented.`,
    });
  }

  return findings;
}

export async function evaluateAccessAuditEvents(
  repoRoot = process.cwd(),
): Promise<AccessAuditEventResult> {
  const findings = (
    await Promise.all(
      accessImplFiles.map(async (file) =>
        evaluateAccessAuditEventSource(
          file,
          await readFile(join(repoRoot, file), "utf8"),
        ),
      ),
    )
  ).flat();

  return { ok: findings.length === 0, findings };
}

export async function runAccessAuditEventsCheck(
  repoRoot = process.cwd(),
): Promise<void> {
  const result = await evaluateAccessAuditEvents(repoRoot);

  if (result.ok) {
    console.log("check:access-audit-events passed");
    return;
  }

  for (const finding of result.findings) {
    console.error(`check:access-audit-events: ${finding.message}`);
  }
  process.exitCode = 1;
}

if (isDirectRun(import.meta.url)) await runAccessAuditEventsCheck();
