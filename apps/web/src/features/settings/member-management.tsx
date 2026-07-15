import { Button, Card, Heading, Stack, Text } from "@saas-ui/react";

import type { MemberManagementAdapter } from "./member-management-adapter";

export const MemberManagement = ({
  adapter,
}: {
  readonly adapter: MemberManagementAdapter;
}) => (
  <Card.Root>
    <Card.Header>
      <Heading size="md">Members</Heading>
    </Card.Header>
    <Card.Body>
      <Stack gap="3">
        {adapter.canManageMembers ? (
          <>
            <Text>
              Admins and owners can invite members, change non-owner roles, and
              remove members through server-verified access mutations.
            </Text>
            <Button>Invite member</Button>
          </>
        ) : (
          <Text>Member management is read-only for this role.</Text>
        )}
        {adapter.canTransferOwnership ? (
          <Text>Ownership transfer is available to owners only.</Text>
        ) : (
          <Text>Only owners can transfer Brain ownership.</Text>
        )}
      </Stack>
    </Card.Body>
  </Card.Root>
);
