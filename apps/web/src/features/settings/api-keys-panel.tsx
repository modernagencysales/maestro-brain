import { Button, Card, Heading, Stack, Text } from "@saas-ui/react";
import { useState } from "react";

import type { ApiKeySettingsMetadata } from "./api-keys";
import type { ApiKeySettingsAdapter } from "./api-keys-adapter";

export type DisplayKeyNotice = {
  readonly action: "created" | "rotated";
  readonly displayKey: string;
  readonly visible: boolean;
  readonly copyStatus: "idle" | "copied";
};

export type ApiKeyOperationState =
  | { readonly status: "idle" }
  | { readonly status: "pending"; readonly message: string }
  | { readonly status: "success"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

const expiryDays = [7, 30, 60, 90] as const;
const millisecondsPerDay = 24 * 60 * 60 * 1_000;

export const expiryFromDays = (
  value: FormDataEntryValue | null,
  nowMs: number = Date.now(),
): number => {
  const days = Number(value);
  if (!expiryDays.some((allowed) => allowed === days)) {
    throw new Error("Choose an API key expiry between 7 and 90 days.");
  }
  return nowMs + days * millisecondsPerDay;
};

export const apiKeyOperationErrorMessage = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof Reflect.get(error, "reason") === "string"
  )
    return String(Reflect.get(error, "reason"));
  if (error instanceof Error && error.message.trim().length > 0)
    return error.message;
  return "The API key operation failed. Try again.";
};

export const confirmApiKeyRevocation = (
  keyName: string,
  confirm: (message: string) => boolean = window.confirm,
): boolean =>
  confirm(
    `Revoke ${keyName}? Agents using this key will lose access immediately.`,
  );

export const runApiKeyOperation = async <T,>({
  onSuccess,
  pendingMessage,
  run,
  setState,
  successMessage,
}: {
  readonly onSuccess?: (value: T) => void;
  readonly pendingMessage: string;
  readonly run: () => Promise<T>;
  readonly setState: (state: ApiKeyOperationState) => void;
  readonly successMessage: string;
}): Promise<void> => {
  setState({ status: "pending", message: pendingMessage });
  try {
    const value = await run();
    onSuccess?.(value);
    setState({ status: "success", message: successMessage });
  } catch (error) {
    setState({ status: "error", message: apiKeyOperationErrorMessage(error) });
  }
};

export const showCreatedDisplayKey = (
  _current: DisplayKeyNotice | undefined,
  displayKey: string,
): DisplayKeyNotice => ({
  action: "created",
  displayKey,
  visible: true,
  copyStatus: "idle",
});

export const showRotatedDisplayKey = (
  _current: DisplayKeyNotice | undefined,
  displayKey: string,
): DisplayKeyNotice => ({
  action: "rotated",
  displayKey,
  visible: true,
  copyStatus: "idle",
});

export const hideDisplayKey = (notice: DisplayKeyNotice): DisplayKeyNotice => ({
  ...notice,
  visible: false,
  copyStatus: "idle",
});

export const showDisplayKey = (notice: DisplayKeyNotice): DisplayKeyNotice => ({
  ...notice,
  visible: true,
  copyStatus: "idle",
});

export const copyDisplayKey = (notice: DisplayKeyNotice): DisplayKeyNotice => ({
  ...notice,
  copyStatus: "copied",
});

export const acknowledgeDisplayKey = (
  notice: DisplayKeyNotice,
): DisplayKeyNotice | undefined => {
  void notice;
  return undefined;
};

type RowState<T> =
  | { readonly status: "loading" }
  | { readonly status: "denied"; readonly message: string }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: readonly T[] };

export const ApiKeysPanel = ({
  adapter,
  keys = { status: "ready", data: [] },
  initialDisplayKeyNotice,
}: {
  readonly adapter: ApiKeySettingsAdapter;
  readonly keys?: RowState<ApiKeySettingsMetadata>;
  readonly initialDisplayKeyNotice?: DisplayKeyNotice;
}) => {
  const [displayKeyNotice, setDisplayKeyNotice] = useState(
    initialDisplayKeyNotice,
  );
  const [operation, setOperation] = useState<ApiKeyOperationState>({
    status: "idle",
  });
  const operationPending = operation.status === "pending";
  const handleCopyDisplayKey = async () => {
    if (displayKeyNotice?.visible === true) {
      await navigator.clipboard
        ?.writeText(displayKeyNotice.displayKey)
        .catch(() => undefined);
    }
    setDisplayKeyNotice((current) =>
      current === undefined ? undefined : copyDisplayKey(current),
    );
  };

  return (
    <Card.Root>
      <Card.Header>
        <Heading size="md">Brain API keys</Heading>
      </Card.Header>
      <Card.Body>
        <Stack gap="4">
          {adapter.canAdministerKeys ? (
            <form
              aria-label="Create API key"
              action={async (formData) => {
                await runApiKeyOperation({
                  pendingMessage: "Creating API key…",
                  successMessage: "API key created. Copy it before continuing.",
                  setState: setOperation,
                  run: () =>
                    adapter.createKey({
                      name: String(formData.get("name") ?? ""),
                      scopes: scopesFromForm(formData),
                      expiresAt: expiryFromDays(formData.get("expiresInDays")),
                    }),
                  onSuccess: (displayKey) =>
                    setDisplayKeyNotice((current) =>
                      showCreatedDisplayKey(current, displayKey),
                    ),
                });
              }}
            >
              <fieldset disabled={operationPending}>
                <Stack gap="2">
                  <Text>
                    Admins create display-once, expiring keys scoped to this
                    Brain.
                  </Text>
                  <label>
                    Name
                    <input name="name" required />
                  </label>
                  <ExpirySelect />
                  <label>
                    <input
                      name="scope"
                      type="checkbox"
                      value="brain:read"
                      defaultChecked
                    />
                    Read
                  </label>
                  <label>
                    <input
                      name="scope"
                      type="checkbox"
                      value="brain:ask"
                      defaultChecked
                    />
                    Ask
                  </label>
                  <Button type="submit">Create API key</Button>
                </Stack>
              </fieldset>
            </form>
          ) : (
            <Text>API key administration is hidden for this role.</Text>
          )}

          <DisplayKeyNoticeCard
            notice={displayKeyNotice}
            onHide={() =>
              setDisplayKeyNotice((current) =>
                current === undefined ? undefined : hideDisplayKey(current),
              )
            }
            onShow={() =>
              setDisplayKeyNotice((current) =>
                current === undefined ? undefined : showDisplayKey(current),
              )
            }
            onCopy={handleCopyDisplayKey}
            onAcknowledge={() =>
              setDisplayKeyNotice((current) =>
                current === undefined
                  ? undefined
                  : acknowledgeDisplayKey(current),
              )
            }
          />

          <ApiKeyOperationNotice state={operation} />

          <ApiKeyRows
            adapter={adapter}
            keys={keys}
            operationPending={operationPending}
            onRotated={(displayKey) =>
              setDisplayKeyNotice((current) =>
                showRotatedDisplayKey(current, displayKey),
              )
            }
            setOperation={setOperation}
          />
        </Stack>
      </Card.Body>
    </Card.Root>
  );
};

const ExpirySelect = () => (
  <label>
    Expires in
    <select defaultValue="30" name="expiresInDays" required>
      {expiryDays.map((days) => (
        <option key={days} value={days}>
          {days} days
        </option>
      ))}
    </select>
    <Text as="span" color="gray.600" fontSize="sm">
      Keys must expire within 90 days. You can rotate them before then.
    </Text>
  </label>
);

const ApiKeyOperationNotice = ({
  state,
}: {
  readonly state: ApiKeyOperationState;
}) =>
  state.status === "idle" ? null : (
    <Text role={state.status === "error" ? "alert" : "status"}>
      {state.message}
    </Text>
  );

const DisplayKeyNoticeCard = ({
  notice,
  onHide,
  onShow,
  onCopy,
  onAcknowledge,
}: {
  readonly notice: DisplayKeyNotice | undefined;
  readonly onHide: () => void;
  readonly onShow: () => void;
  readonly onCopy: () => void;
  readonly onAcknowledge: () => void;
}) =>
  notice === undefined ? null : (
    <Card.Root>
      <Card.Body>
        <Stack gap="2">
          <Heading size="sm">
            API key {notice.action === "created" ? "created" : "rotated"}
          </Heading>
          <Text>
            Copy this key now. It is shown once and cannot be recovered.
          </Text>
          {notice.visible ? (
            <code>{notice.displayKey}</code>
          ) : (
            <Text>Display key hidden.</Text>
          )}
          {notice.copyStatus === "copied" ? (
            <Text>Copied display key.</Text>
          ) : null}
          <Button type="button" onClick={notice.visible ? onHide : onShow}>
            {notice.visible ? "Hide display key" : "Show display key"}
          </Button>
          <Button type="button" onClick={onCopy}>
            Copy display key
          </Button>
          <Button type="button" onClick={onAcknowledge}>
            I have saved this key
          </Button>
        </Stack>
      </Card.Body>
    </Card.Root>
  );

const ApiKeyRows = ({
  adapter,
  keys,
  onRotated,
  operationPending,
  setOperation,
}: {
  readonly adapter: ApiKeySettingsAdapter;
  readonly keys: RowState<ApiKeySettingsMetadata>;
  readonly onRotated: (displayKey: string) => void;
  readonly operationPending: boolean;
  readonly setOperation: (state: ApiKeyOperationState) => void;
}) => (
  <Stack gap="2">
    <Heading size="sm">Existing keys</Heading>
    {keys.status === "loading" ? <Text>Loading API keys…</Text> : null}
    {keys.status === "denied" ? <Text>{keys.message}</Text> : null}
    {keys.status === "error" ? <Text>{keys.message}</Text> : null}
    {keys.status === "ready" && keys.data.length === 0 ? (
      <Text>No API keys found.</Text>
    ) : null}
    {keys.status === "ready"
      ? keys.data.map((key) => (
          <div key={key.id} data-api-key-row={key.id}>
            <Text>
              {key.name} — {key.status} — {key.displayPrefix}
            </Text>
            <Text>
              {adapter.brainKey} — {key.scopes.join(", ")} — viewer ceiling
            </Text>
            {adapter.canAdministerKeys ? (
              <form
                aria-label={`Rotate ${key.name}`}
                action={async (formData) => {
                  await runApiKeyOperation({
                    pendingMessage: `Rotating ${key.name}…`,
                    successMessage: `${key.name} rotated. Copy the new key before continuing.`,
                    setState: setOperation,
                    run: () =>
                      adapter.rotateKey({
                        keyId: key.id,
                        expiresAt: expiryFromDays(
                          formData.get("expiresInDays"),
                        ),
                      }),
                    onSuccess: onRotated,
                  });
                }}
              >
                <fieldset disabled={operationPending}>
                  <ExpirySelect />
                  <Button type="submit">Rotate key</Button>
                </fieldset>
              </form>
            ) : null}
            {adapter.canAdministerKeys ? (
              <form
                aria-label={`Revoke ${key.name}`}
                action={async () => {
                  if (!confirmApiKeyRevocation(key.name)) return;
                  await runApiKeyOperation({
                    pendingMessage: `Revoking ${key.name}…`,
                    successMessage: `${key.name} revoked.`,
                    setState: setOperation,
                    run: () => adapter.revokeKey({ keyId: key.id }),
                  });
                }}
              >
                <Button disabled={operationPending} type="submit">
                  Revoke key
                </Button>
              </form>
            ) : null}
          </div>
        ))
      : null}
  </Stack>
);

const scopesFromForm = (
  formData: FormData,
): readonly ("brain:read" | "brain:ask")[] => {
  const scopes = formData
    .getAll("scope")
    .filter(
      (scope): scope is "brain:read" | "brain:ask" =>
        scope === "brain:read" || scope === "brain:ask",
    );

  return scopes.length === 0 ? ["brain:read"] : scopes;
};
