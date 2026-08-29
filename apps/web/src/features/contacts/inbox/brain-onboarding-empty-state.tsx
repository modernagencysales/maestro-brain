'use client'

import { Box, HStack, Heading, SimpleGrid, Text, VStack } from '@chakra-ui/react'
import { Button, Page } from '@saas-ui/react'
import {
  LuFilePlus2,
  LuFolderClosed,
  LuMessageSquare,
  LuTerminal,
} from 'react-icons/lu'

type BrainOnboardingEmptyStateProps = {
  onConnectDrive: () => void
  onConnectSlack: () => void
  onConnectTerminal: () => void
  onCreatePage: () => void
}

const onboardingSteps = [
  {
    title: 'Choose one narrow scope',
    description: 'Start with one useful Slack channel or Drive folder.',
  },
  {
    title: 'Sync the source',
    description: 'The Brain indexes the approved source and keeps its provenance.',
  },
  {
    title: 'Ask from anywhere',
    description: 'Use this workspace, the CLI, or HTTP MCP against the same context.',
  },
] as const

export function BrainOnboardingEmptyState({
  onConnectDrive,
  onConnectSlack,
  onConnectTerminal,
  onCreatePage,
}: BrainOnboardingEmptyStateProps) {
  return (
    <Page.Root as="section" aria-label="Get started with Company Brain" flex="1">
      <Page.Body display="flex" alignItems="center" justifyContent="center">
        <VStack align="stretch" gap="8" maxW="760px" width="100%" py="8">
          <VStack align="start" gap="2">
            <Heading as="h1" textStyle="2xl">
              Build your shared company context
            </Heading>
            <Text color="fg.muted" maxW="2xl">
              Bring in one trusted source, then make the same grounded context
              available to your team and terminal agents.
            </Text>
          </VStack>

          <SimpleGrid columns={{ base: 1, md: 2 }} gap="3">
            <Button variant="primary" justifyContent="start" onClick={onConnectSlack}>
              <LuMessageSquare /> Connect Slack
            </Button>
            <Button variant="secondary" justifyContent="start" onClick={onConnectDrive}>
              <LuFolderClosed /> Connect Drive
            </Button>
            <Button variant="secondary" justifyContent="start" onClick={onCreatePage}>
              <LuFilePlus2 /> Create Brain page
            </Button>
            <Button
              variant="secondary"
              justifyContent="start"
              onClick={onConnectTerminal}
            >
              <LuTerminal /> Connect Terminal &amp; MCP
            </Button>
          </SimpleGrid>

          <SimpleGrid columns={{ base: 1, md: 3 }} gap="4">
            {onboardingSteps.map((step, index) => (
              <HStack key={step.title} align="start" gap="3">
                <Box
                  aria-hidden="true"
                  bg="bg.muted"
                  borderRadius="full"
                  flex="none"
                  fontWeight="semibold"
                  height="7"
                  lineHeight="7"
                  textAlign="center"
                  width="7"
                >
                  {index + 1}
                </Box>
                <VStack align="start" gap="1">
                  <Text fontWeight="medium" textStyle="sm">
                    {step.title}
                  </Text>
                  <Text color="fg.muted" textStyle="xs">
                    {step.description}
                  </Text>
                </VStack>
              </HStack>
            ))}
          </SimpleGrid>
        </VStack>
      </Page.Body>
    </Page.Root>
  )
}
