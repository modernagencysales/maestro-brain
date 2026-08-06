import { useRef, useState } from "react";
import { Button, Stack, Text } from "@saas-ui/react";

export function ExportDialog({
  disabled,
  disabledReason,
  pending,
  onRequest,
}: {
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly pending: boolean;
  readonly onRequest: (idempotencyKey: string) => Promise<void> | void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  return (
    <form
      aria-label="Request Brain export"
      action={async () => {
        idempotencyKey.current ??= `brain-export-${crypto.randomUUID()}`;
        await onRequest(idempotencyKey.current);
        idempotencyKey.current = null;
      }}
    >
      <Stack gap="3">
        <label>
          <input
            checked={confirmed}
            disabled={disabled || pending}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            type="checkbox"
          />{" "}
          Downloaded copies leave Maestro control and must be secured and
          deleted separately.
        </label>
        {disabledReason ? <Text color="red.600">{disabledReason}</Text> : null}
        <Button
          disabled={disabled || pending || !confirmed}
          loading={pending}
          type="submit"
        >
          {pending ? "Requesting export…" : "Request Brain export"}
        </Button>
      </Stack>
    </form>
  );
}
