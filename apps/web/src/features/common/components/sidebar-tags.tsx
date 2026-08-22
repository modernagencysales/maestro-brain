import React from "react";

import { Text, useControllableState } from "@chakra-ui/react";
import { createLink } from "@tanstack/react-router";

import type { TagDTO } from "@workspace/api/types";
import {
  SortableNavGroup,
  SortableNavItem,
} from "@workspace/ui/sortable-nav-group";
import { TagColor } from "@workspace/ui/tags-list";

import { useTags } from "../hooks/use-tags";

export const AppSidebarTags = () => {
  const tags = useTags();

  const getSortedTags = React.useCallback((tags: readonly TagDTO[]) => {
    return [...tags];
  }, []);

  const [sortedTags, setTags] = useControllableState<TagDTO[]>({
    defaultValue: getSortedTags(tags || []),
    onChange(tags) {
      void tags;
    },
  });

  if (!sortedTags.length) {
    return null;
  }

  return (
    <SortableNavGroup items={sortedTags} onSorted={setTags}>
      {sortedTags.map((tag) => (
        <TagLink
          as="a"
          key={tag.id}
          id={tag.id}
          my="0"
          to="/contacts"
          hash={`tag-${tag.id}`}
          activeProps={{
            "data-active": true,
          }}
        >
          <TagColor color={tag.color ?? undefined} />
          <Text>{tag.name}</Text>
        </TagLink>
      ))}
    </SortableNavGroup>
  );
};

const TagLink = createLink(SortableNavItem);
