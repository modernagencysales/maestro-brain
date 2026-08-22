import { useSplitPage } from "@saas-ui-pro/react";
import { Box, type BoxProps, GridList, HStack, Text } from "@saas-ui/react";
import { createLink } from "@tanstack/react-router";

import { NotificationDTO } from "@workspace/api/types";
import { DateTimeSince } from "@workspace/ui/date-time";

import { UserAvatar } from "#components/user-avatar";
import { useWorkspaceSlug } from "#features/common/hooks/use-workspace-slug";
import { api } from "#lib/trpc/react";

const UnreadBadge: React.FC<BoxProps> = (props) => {
  return (
    <Box boxSize="2" borderRadius="full" bg="accent.solid" p="0" {...props} />
  );
};

export interface InboxListProps extends GridList.RootProps {
  items: NotificationDTO[];
}

export const InboxList: React.FC<InboxListProps> = (props) => {
  const { items = [], ...rest } = props;
  return (
    <GridList.Root variant="rounded" interactive {...rest}>
      {items.map((item) => (
        <InboxListItem key={item.id} item={item} />
      ))}
    </GridList.Root>
  );
};

interface InboxListItemProps {
  item: NotificationDTO;
}

const InboxListItem: React.FC<InboxListItemProps> = (props) => {
  const { item } = props;
  const { onOpen } = useSplitPage();

  return (
    <ListLink
      to="/contacts/$contactId"
      params={{
        contactId: item.subjectId,
      }}
      activeProps={{
        "data-active": true,
      }}
      onClick={() => {
        onOpen();
      }}
      preload={"intent"}
      data-unread={!item.readAt ? "" : undefined}
    >
      <GridList.Cell width="10">
        <ActorAvatar item={item} />
      </GridList.Cell>
      <GridList.Cell flex="1" display="flex" flexDirection="column">
        <HStack alignItems="center">
          {!item.readAt ? <UnreadBadge /> : null}

          <Text
            lineClamp={1}
            flex="1"
            color="fg.muted"
            css={{
              "[data-unread] &": {
                color: "fg",
              },
            }}
          >
            {item.subject?.name}
          </Text>
          <DateTimeSince
            date={new Date(item.createdAt)}
            format="short"
            color="fg.muted"
            fontSize="xs"
            flexShrink="0"
          />
        </HStack>

        <Message item={item} />
      </GridList.Cell>
    </ListLink>
  );
};

const ListLink = createLink(GridList.Item);

const ActorAvatar = ({ item }: { item: NotificationDTO }) => {
  const actor = useActor(item.actorId);

  return actor ? <UserAvatar user={actor} size="md" /> : null;
};

const useActor = (id: string | null) => {
  const workspace = useWorkspaceSlug();
  const utils = api.useUtils();

  if (!id) {
    return null;
  }

  return utils.workspaces.bySlug
    .getData({
      slug: workspace,
    })
    ?.members.find((m) => m.id === id);
};

/**
 * @important dangerouslySetInnerHTML is used here to render the comment,
 * this is because the comment can contain HTML tags.
 *
 * You should make sure to sanitize the HTML before rendering it.
 *
 * @see https://reactjs.org/docs/dom-elements.html#dangerouslysetinnerhtml
 */
const Message = ({ item }: { item: NotificationDTO }) => {
  const actor = useActor(item.actorId);

  if (item.type === "comment" && item.metadata?.comment) {
    return (
      <CommentMessage actorName={actor?.name} html={item.metadata.comment} />
    );
  }

  return (
    <Text fontSize="xs" color="fg.muted" lineClamp={2}>
      <Text as="span">{actor?.name}</Text> {notificationMessage(item)}
    </Text>
  );
};

const CommentMessage = ({
  actorName,
  html,
}: {
  actorName?: string | null;
  html: string;
}) => (
  <Text fontSize="xs" lineClamp={2}>
    <Text as="span" color="inherit">
      {actorName}
    </Text>{" "}
    —{" "}
    <Text
      as="span"
      color="fg.muted"
      wordBreak="break-all"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  </Text>
);

const notificationMessage = (item: NotificationDTO): string => {
  const tags = Array.isArray(item.metadata?.tags) ? item.metadata.tags : [];
  const messages: Partial<Record<string, string>> = {
    action:
      item.metadata?.action === "created-contact" ? "created contact" : "",
    update: `updated ${item.metadata?.field} to ${item.metadata?.value}`,
    comment: "left a comment",
    tags: "updated tags to " + tags.join(", "),
    type: `changed type to ${item.metadata?.type}`,
    status: `changed status to ${item.metadata?.status}`,
  };
  return messages[item.type ?? ""] ?? "";
};
