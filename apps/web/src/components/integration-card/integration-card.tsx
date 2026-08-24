import type { FC } from "react";

import {
  Button,
  ButtonGroup,
  Card,
  Heading,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { IconType } from "react-icons";
import { LuExternalLink, LuLink } from "react-icons/lu";

import { IconBadge } from "../icon-badge/icon-badge";

export type IntegrationCardProps = {
  name: string;
  type: string;
  description: string;
  icon: IconType;
  docs: string;
  isConnected?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onDocs?: () => void;
};

/** Exact Saas UI Pro IntegrationCard composition with behavior behind props. */
export const IntegrationCard: FC<IntegrationCardProps> = (props) => {
  return (
    <Card.Root size="md">
      <Card.Header>
        <HStack gap="2" alignItems="flex-start">
          <IconBadge
            icon={<Icon as={props.icon} color="white" />}
            bg="black"
            variant="solid"
            size="md"
          />

          <VStack alignItems="flex-start" gap="0">
            <Heading as="h4" size="sm" fontWeight="medium" lineHeight="1.4">
              {props.name}
            </Heading>
            <Text color="fg.muted" textStyle="xs">
              {props.type}
            </Text>
          </VStack>
        </HStack>
      </Card.Header>
      <Card.Body>
        <Text color="fg.subtle" textStyle="sm">
          {props.description}
        </Text>
      </Card.Body>
      <Card.Footer>
        <ButtonGroup gap="2">
          {!props.isConnected ? (
            <Button
              variant="solid"
              colorPalette="accent"
              onClick={props.onConnect}
            >
              <Icon as={LuLink} /> Connect
            </Button>
          ) : (
            <Button variant="outline" onClick={props.onDisconnect}>
              Disconnect
            </Button>
          )}
          <Button variant="ghost" onClick={props.onDocs}>
            <Icon as={LuExternalLink} /> Docs
          </Button>
        </ButtonGroup>
      </Card.Footer>
    </Card.Root>
  );
};
