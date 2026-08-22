import { Badge, Box, type BoxProps, Text } from "@chakra-ui/react";

import { useTags } from "../../common/hooks/use-tags";

export const ContactTag: React.FC<BoxProps & { tag: string; size?: string }> = (
  props,
) => {
  const { tag, size, ...rest } = props;

  const tags = useTags();

  const t = tags.find((t) => t.id === tag);

  if (!t) return null;

  return (
    <Box
      display="inline-flex"
      alignItems="center"
      rounded="full"
      bg="bg.muted"
      px="2"
      h="6"
      data-size={size}
      {...rest}
    >
      <Badge bg={t.color ?? undefined} boxSize="2" rounded="full" me="2" />
      <Text>{t.name}</Text>
    </Box>
  );
};
