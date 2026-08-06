export type BrainReviewQueueItem = {
  readonly sourceKey: string;
  readonly title: string;
  readonly submittedAt: number;
  readonly status: "pending_review" | "published" | "rejected";
  readonly route: "direct" | "classify" | "capture-only" | null;
};

export type BrainReviewQueueState =
  | { readonly status: "loading" }
  | { readonly status: "empty"; readonly items: readonly [] }
  | {
      readonly status: "ready";
      readonly items: readonly BrainReviewQueueItem[];
    }
  | { readonly status: "failure"; readonly message: string };

const ageLabel = (nowMs: number, submittedAt: number): string => {
  const minutes = Math.max(0, Math.floor((nowMs - submittedAt) / 60_000));
  return minutes === 0
    ? "less than 1 minute old"
    : `${minutes} minute${minutes === 1 ? "" : "s"} old`;
};

export function ReviewQueue({
  nowMs,
  role,
  state,
  onDecision,
}: {
  readonly nowMs: number;
  readonly role: "viewer" | "editor" | "admin" | "owner";
  readonly state: BrainReviewQueueState;
  readonly onDecision?: (
    sourceKey: string,
    decision: "approve" | "reject",
  ) => void;
}) {
  const canReview = role !== "viewer";
  return (
    <section aria-label="Brain review queue">
      <h2>Review queue</h2>
      {state.status === "loading" ? (
        <p role="status">Loading review queue…</p>
      ) : null}
      {state.status === "failure" ? <p role="alert">{state.message}</p> : null}
      {state.status === "empty" ? (
        <p>No pending Brain maintenance items.</p>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <p>No pending Brain maintenance items.</p>
      ) : null}
      {state.status === "ready"
        ? state.items.map((item) => (
            <div key={item.sourceKey}>
              <div>
                <strong>{item.title}</strong> <span>{item.status}</span>
              </div>
              <p>{ageLabel(nowMs, item.submittedAt)}</p>
              <p>Route: {item.route ?? "not routed"}</p>
              <div>
                <button
                  disabled={!canReview || item.status !== "pending_review"}
                  type="button"
                  onClick={() => onDecision?.(item.sourceKey, "approve")}
                >
                  Approve
                </button>
                <button
                  disabled={!canReview || item.status !== "pending_review"}
                  type="button"
                  onClick={() => onDecision?.(item.sourceKey, "reject")}
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        : null}
    </section>
  );
}
