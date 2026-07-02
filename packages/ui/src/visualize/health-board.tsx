import { Badge } from "@notion-kit/ui/primitives";
import { VisualShell, type VisualState } from "./shared";

export type HealthCheck = {
  readonly label: string;
  readonly status: "ready" | "degraded" | "blocked";
};

export function TemplateHealthBoard({
  checks,
  state,
}: {
  readonly checks: readonly HealthCheck[];
  readonly state: VisualState;
}) {
  return (
    <VisualShell
      title="Health board"
      state={state}
      emptyLabel="No checks"
      errorLabel="Could not load health"
    >
      <div className="template-health-board">
        {checks.map((check) => (
          <article className="template-health-row" key={check.label}>
            <span>{check.label}</span>
            <Badge>{check.status}</Badge>
          </article>
        ))}
      </div>
    </VisualShell>
  );
}
