import {
  Badge,
  Box,
  Card,
  Flex,
  Heading,
  Page,
  Stack,
  Text,
} from "@saas-ui/react";
import { ClientsTable } from "./clients-table";
import { CreateClientDialog } from "./create-client-dialog";
import type { ClientOnboardingState, CreateClientInput } from "./clients-state";

export type ClientsScreenState =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "typed_failure" }
  | { readonly status: "transport_failure" }
  | {
      readonly status: "ready";
      readonly clients: readonly ClientRow[];
    };

export type ClientRow = {
  readonly key: string;
  readonly name: string;
  readonly health: string;
  readonly freshness: string;
  readonly connections: number;
  readonly recentChanges: number;
};

export function ClientsScreen({
  state,
  onboarding = { status: "idle" },
  onCreateClient = () => undefined,
}: {
  readonly state: ClientsScreenState;
  readonly onboarding?: ClientOnboardingState;
  readonly onCreateClient?: (input: CreateClientInput) => void;
}) {
  return (
    <>
      <Page.Header
        title="Clients"
        description="Client Brains, freshness, and recent activity in one focused workspace."
      />
      <Page.Body px={{ base: "4", md: "6" }} pb="8">
        <Stack gap="4">
          <CreateClientDialog
            onboarding={onboarding}
            onSubmit={onCreateClient}
          />
          <ClientsStateCard state={state} />
        </Stack>
      </Page.Body>
    </>
  );
}

function ClientsStateCard({ state }: { readonly state: ClientsScreenState }) {
  if (state.status === "loading") {
    return (
      <StateCard
        title="Loading client Brains"
        description="Preparing the client list."
      />
    );
  }

  if (state.status === "empty") {
    return (
      <StateCard
        title="No client Brains yet"
        description="Create the first client Brain to start a Brief."
      />
    );
  }

  if (state.status === "typed_failure") {
    return (
      <StateCard
        title="Client list unavailable"
        description="The request was rejected by a typed product contract."
        tone="yellow"
      />
    );
  }

  if (state.status === "transport_failure") {
    return (
      <StateCard
        title="Connection interrupted"
        description="Check connectivity and retry the client list."
        tone="red"
      />
    );
  }

  return (
    <Card.Root borderRadius="md">
      <Card.Header>
        <Flex align="center" justify="space-between" gap="3">
          <Box>
            <Heading size="md">Client Brains</Heading>
            <Text color="gray.600" fontSize="sm">
              Ready client context with freshness and connection counts.
            </Text>
          </Box>
          <Badge colorPalette="green">Ready</Badge>
        </Flex>
      </Card.Header>
      <Card.Body pt="0">
        <ClientsTable clients={state.clients} />
      </Card.Body>
    </Card.Root>
  );
}

function StateCard({
  description,
  title,
  tone = "blue",
}: {
  readonly description: string;
  readonly title: string;
  readonly tone?: "blue" | "red" | "yellow";
}) {
  return (
    <Card.Root borderRadius="md">
      <Card.Body>
        <Stack gap="3">
          <Badge alignSelf="flex-start" colorPalette={tone}>
            {title}
          </Badge>
          <Heading size="md">{title}</Heading>
          <Text color="gray.600">{description}</Text>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
