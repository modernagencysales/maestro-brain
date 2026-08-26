import { Container, Heading, Stack, Text } from '@chakra-ui/react'

export const Testimonial = () => {
  return (
    <Container maxW="lg">
      <Stack gap="4">
        <Heading color="white" size="2xl">
          One shared company Brain.
        </Heading>
        <Text color="whiteAlpha.800" textStyle="lg">
          Keep company context, connected sources, and terminal agents working
          from the same evidence.
        </Text>
      </Stack>
    </Container>
  )
}
