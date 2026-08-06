export type BrainRestoreState = "idle" | "restoring" | "failure" | "success";

export function RestoreDialog({
  open,
  canRestore,
  revisionKey,
  state = "idle",
  message,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly canRestore: boolean;
  readonly revisionKey: string;
  readonly state?: BrainRestoreState;
  readonly message?: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <section aria-label="Restore revision" role="dialog">
      <h2>Restore revision</h2>
      <div>
        <p>
          Restore {revisionKey} as a new revision? Existing history will remain
          unchanged.
        </p>
        {message ? (
          <p role={state === "failure" ? "alert" : "status"}>{message}</p>
        ) : null}
        <div>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            disabled={!canRestore || state === "restoring"}
            type="button"
            onClick={onConfirm}
          >
            {state === "restoring" ? "Restoring…" : "Restore revision"}
          </button>
        </div>
      </div>
    </section>
  );
}
