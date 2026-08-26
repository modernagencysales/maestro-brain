import React from "react";

import {
  ButtonGroup,
  Card,
  HStack,
  Heading,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuExternalLink, LuLink, LuRefreshCw } from "react-icons/lu";

import { Button } from "@/components/ui/button/button";
import { IconBadge } from "@/components/ui/icon-badge/icon-badge";

export type IntegrationCardProps = {
  name: string;
  type: string;
  description: string;
  icon: any;
  docs: string;
  isConnected?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSync?: () => void;
  onDocs?: () => void;
};

export const IntegrationCard: React.FC<IntegrationCardProps> = (props) => {
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
              variant="glass"
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
          {props.isConnected && props.onSync ? (
            <Button variant="outline" onClick={props.onSync}>
              <Icon as={LuRefreshCw} /> Sync now
            </Button>
          ) : null}
          <Button variant="ghost" onClick={props.onDocs}>
            <Icon as={LuExternalLink} /> Docs
          </Button>
        </ButtonGroup>
      </Card.Footer>
    </Card.Root>
  );
};
