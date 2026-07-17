import { Button, Card, Heading, Stack, Text } from "@saas-ui/react";

import type { ApiKeySettingsMetadata } from "./api-keys";
import type { ApiKeySettingsAdapter } from "./api-keys-adapter";

type RowState<T> =
  | { readonly status: "loading" }
  | { readonly status: "denied"; readonly message: string }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: readonly T[] };

export const ApiKeysPanel = ({
  adapter,
  keys = { status: "ready", data: [] },
}: {
  readonly adapter: ApiKeySettingsAdapter;
  readonly keys?: RowState<ApiKeySettingsMetadata>;
}) => (
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
              await adapter.createKey({
                name: String(formData.get("name") ?? ""),
                scopes: scopesFromForm(formData),
                expiresAt: Number(formData.get("expiresAt") ?? 0),
              });
            }}
          >
            <Stack gap="2">
              <Text>
                Admins create display-once, expiring keys scoped to this Brain.
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

        <ApiKeyRows adapter={adapter} keys={keys} />
      </Stack>
    </Card.Body>
  </Card.Root>
);

const ApiKeyRows = ({
  adapter,
  keys,
}: {
  readonly adapter: ApiKeySettingsAdapter;
  readonly keys: RowState<ApiKeySettingsMetadata>;
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
              {key.brainKey} — {key.scopes.join(", ")} — viewer ceiling
            </Text>
            {adapter.canAdministerKeys ? (
              <form
                aria-label={`Rotate ${key.name}`}
                action={async (formData) => {
                  await adapter.rotateKey({
                    keyId: key.id,
                    expiresAt: Number(formData.get("expiresAt") ?? 0),
                  });
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
