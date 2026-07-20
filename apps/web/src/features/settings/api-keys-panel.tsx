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
                const displayKey = await adapter.createKey({
                  name: String(formData.get("name") ?? ""),
                  scopes: scopesFromForm(formData),
                  expiresAt: Number(formData.get("expiresAt") ?? 0),
                });
                setDisplayKeyNotice((current) =>
                  showCreatedDisplayKey(current, displayKey),
                );
              }}
            >
              <Stack gap="2">
                <Text>
                  Admins create display-once, expiring keys scoped to this
                  Brain.
                </Text>
                <label>
                  Name
                  <input name="name" required />
                </label>
                <label>
                  Expires at
                  <input name="expiresAt" type="number" required />
                </label>
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
                  <input name="scope" type="checkbox" value="brain:ask" />
                  Ask
                </label>
                <Button type="submit">Create API key</Button>
              </Stack>
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

          <ApiKeyRows
            adapter={adapter}
            keys={keys}
            onRotated={(displayKey) =>
              setDisplayKeyNotice((current) =>
                showRotatedDisplayKey(current, displayKey),
              )
            }
          />
        </Stack>
      </Card.Body>
    </Card.Root>
  );
};

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
}: {
  readonly adapter: ApiKeySettingsAdapter;
  readonly keys: RowState<ApiKeySettingsMetadata>;
  readonly onRotated: (displayKey: string) => void;
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
                  const displayKey = await adapter.rotateKey({
                    keyId: key.id,
                    expiresAt: Number(formData.get("expiresAt") ?? 0),
                  });
                  onRotated(displayKey);
                }}
              >
                <input name="expiresAt" type="number" required />
                <Button type="submit">Rotate key</Button>
              </form>
            ) : null}
            {adapter.canAdministerKeys ? (
              <form
                aria-label={`Revoke ${key.name}`}
                action={async () => {
                  await adapter.revokeKey({ keyId: key.id });
                }}
              >
                <Button type="submit">Revoke key</Button>
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
