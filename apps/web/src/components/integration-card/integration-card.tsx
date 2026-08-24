import type { ReactNode } from "react";

import {
  ButtonGroup,
  Card,
  HStack,
  Heading,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { IconType } from "react-icons";

import { IconBadge } from "../icon-badge/icon-badge";

export type IntegrationCardProps = {
  readonly actions: ReactNode;
  readonly description: string;
  readonly details?: ReactNode;
  readonly icon: IconType;
  readonly name: string;
  readonly type: string;
};

/** Canonical maestro-template-saas-ui integration-card composition. */
export function IntegrationCard({
  actions,
  description,
  details,
  icon,
  name,
  type,
}: IntegrationCardProps) {
  return (
    <Card.Root size="md">
      <Card.Header>
        <HStack gap="2" alignItems="flex-start">
          <IconBadge
            icon={<Icon as={icon} color="white" />}
            bg="black"
            variant="solid"
            size="md"
          />
          <VStack alignItems="flex-start" gap="0">
            <Heading as="h3" size="sm" fontWeight="medium" lineHeight="1.4">
              {name}
            </Heading>
            <Text color="fg.muted" textStyle="xs">
              {type}
            </Text>
          </VStack>
        </HStack>
      </Card.Header>
      <Card.Body gap="3">
        <Text color="fg.subtle" textStyle="sm">
          {description}
        </Text>
        {details}
      </Card.Body>
      <Card.Footer>
        <ButtonGroup gap="2" flexWrap="wrap">
          {actions}
        </ButtonGroup>
      </Card.Footer>
    </Card.Root>
  );
}
