import { useState, type ChangeEvent, type FormEvent } from "react";
import { Box, Button, Card, Input, Stack, Text } from "@saas-ui/react";
import {
  buildCreateClientInput,
  type ClientOnboardingState,
  type CreateClientInput,
} from "./clients-state";

export function CreateClientDialog({
  onboarding,
  onSubmit,
}: {
  readonly onboarding: ClientOnboardingState;
  readonly onSubmit: (input: CreateClientInput) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [retryKey, setRetryKey] = useState<string | undefined>();
  const [submittedSignature, setSubmittedSignature] = useState<
    string | undefined
  >();
  const busy =
    onboarding.status === "creating" || onboarding.status === "seeding";
  const disabled = busy || name.trim().length === 0 || slug.trim().length === 0;
  const signatureFor = (nextName: string, nextSlug: string) =>
    `${nextName.trim()}::${nextSlug.trim().toLowerCase()}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const signature = signatureFor(name, slug);
    const input = buildCreateClientInput({
      name,
      clientSlug: slug,
      existingIdempotencyKey:
        submittedSignature === signature ? retryKey : undefined,
    });
    setSubmittedSignature(signature);
    setRetryKey(input.idempotencyKey);
    onSubmit(input);
  };
  const updateName = (event: ChangeEvent<HTMLInputElement>) => {
    const nextName = event.currentTarget.value;
    setName(nextName);
    if (signatureFor(nextName, slug) !== submittedSignature)
      setRetryKey(undefined);
  };
  const updateSlug = (event: ChangeEvent<HTMLInputElement>) => {
    const nextSlug = event.currentTarget.value;
    setSlug(nextSlug);
    if (signatureFor(name, nextSlug) !== submittedSignature)
      setRetryKey(undefined);
  };

  return (
    <Card.Root
      as="form"
      aria-label="Create client Brain"
      onSubmit={submit}
      borderRadius="md"
    >
      <Card.Header>Create client Brain</Card.Header>
      <Card.Body>
        <Stack gap="3">
          <Input
            aria-label="Client name"
            value={name}
            onChange={updateName}
            placeholder="Acme Co"
          />
          <Input
            aria-label="Client slug"
            value={slug}
            onChange={updateSlug}
            placeholder="acme-co"
          />
          <Button disabled={disabled} type="submit">
            {busy ? "Creating…" : "Create Client Brief"}
          </Button>
          <Box aria-live="polite">
            {onboarding.status === "creating" ? (
              <Text>Creating client Brain…</Text>
            ) : null}
            {onboarding.status === "seeding" ? (
              <Text>Seeding six-page Client Brief…</Text>
            ) : null}
            {onboarding.status === "ready" ? (
              <Text>
                Client Brief ready. Capacity {onboarding.capacity.clientBrains}/
                {onboarding.capacity.clientBrainLimit};{" "}
                {onboarding.capacity.remainingClientBrains} remaining.
              </Text>
            ) : null}
            {onboarding.status === "failed" ? (
              <Text color="red.600">{onboarding.message}</Text>
            ) : null}
          </Box>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
