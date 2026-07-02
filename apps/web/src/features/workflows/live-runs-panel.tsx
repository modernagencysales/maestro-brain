import { templateConfectRefs } from "@maestro-template/convex";
import { useTemplateQuery } from "../../adapters/confect-state";
import { isConvexConfigured } from "../../env";
import { presentLiveRuns } from "./live-runs-presenter";

/**
 * Live workflow runs from the deployed Convex backend. This is the panel
 * that proves the hosted reference app is a working full-stack system:
 * the rows come from the seeded read-only demo workspace over a real
 * Convex subscription, not from bundled fixture data.
 */
export function LiveWorkflowRunsPanel() {
  const state = useTemplateQuery(
    templateConfectRefs.public.demo.showcase.overview,
    isConvexConfigured() ? {} : "skip",
  );
  const view = presentLiveRuns(state);

  return (
    <section className="notion-section" aria-label="Live workspace data">
      <h2>Live workspace data</h2>
      {view.kind === "unconfigured" ? (
        <p>
          No Convex deployment is configured for this build. The document above
          is static content; deploy the backend and set{" "}
          <code>VITE_CONVEX_URL</code> to see live runs here.
        </p>
      ) : null}
      {view.kind === "connecting" ? (
        <p>Connecting to the live backend…</p>
      ) : null}
      {view.kind === "unavailable" ? (
        <p>Live backend unavailable: {view.detail}</p>
      ) : null}
      {view.kind === "unseeded" ? (
        <p>
          Connected, but the demo workspace has not been seeded. Run{" "}
          <code>convex run demo/showcase:seed</code>.
        </p>
      ) : null}
      {view.kind === "ready" ? (
        <>
          <p>
            Streaming from workspace <strong>{view.workspaceName}</strong> —
            these rows come from the live backend, not from content bundled with
            the page.
          </p>
          <ul>
            {view.rows.map((row) => (
              <li key={row.key}>
                <code>{row.workflowId}</code> v{row.workflowVersion} —{" "}
                {row.status}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
