import { Badge, Button, Card, HStack, Stack, Text } from "@saas-ui/react";
import type { BrainPageTreeItem } from "./brain-surface";

export function BrainPageTree({
  canEdit,
  pages,
  onArchivePage,
  onCreatePage,
  onFavoritePage,
  onMovePage,
  onRenamePage,
  onSelectPage,
}: {
  readonly canEdit: boolean;
  readonly pages: readonly BrainPageTreeItem[];
  readonly onArchivePage: (pageKey: string, revisionKey: string | null) => void;
  readonly onCreatePage: () => void;
  readonly onFavoritePage: (
    pageKey: string,
    favorite: boolean,
    revisionKey: string | null,
  ) => void;
  readonly onMovePage: (
    pageKey: string,
    parentPageKey: string | null,
    revisionKey: string | null,
  ) => void;
  readonly onRenamePage: (
    pageKey: string,
    title: string,
    revisionKey: string | null,
  ) => void;
  readonly onSelectPage: (pageKey: string) => void;
}) {
  return (
    <Card.Root borderRadius="md" h="100%">
      <Card.Header>
        <HStack justify="space-between">
          <Text fontWeight="semibold">Page tree</Text>
          <Badge colorPalette={canEdit ? "green" : "gray"}>
            {canEdit ? "Editable tree" : "Read-only tree"}
          </Badge>
        </HStack>
      </Card.Header>
      <Card.Body pt="0">
        <Stack aria-label="Brain pages" gap="2" role="tree" tabIndex={0}>
          {pages.map((page) => (
            <HStack
              aria-selected={page.isSelected}
              key={page.pageKey}
              pl={page.parentPageKey ? "5" : "0"}
              role="treeitem"
              justify="space-between"
            >
              <Button
                justifyContent="flex-start"
                size="sm"
                variant={page.isSelected ? "subtle" : "ghost"}
                onClick={() => onSelectPage(page.pageKey)}
              >
                {page.isFavorite ? "★ " : ""}
                {page.title}
              </Button>
              {canEdit ? (
                <HStack gap="1">
                  <Button
                    aria-label="Favorite page"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      onFavoritePage(
                        page.pageKey,
                        !page.isFavorite,
                        page.currentRevisionKey,
                      )
                    }
                  >
                    ★
                  </Button>
                  <Button
                    aria-label="Rename page"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      onRenamePage(
                        page.pageKey,
                        page.title,
                        page.currentRevisionKey,
                      )
                    }
                  >
                    Rename
                  </Button>
                  <Button
                    aria-label="Move page to root"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      onMovePage(page.pageKey, null, page.currentRevisionKey)
                    }
                  >
                    Move
                  </Button>
                  <Button
                    aria-label="Archive page"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      onArchivePage(page.pageKey, page.currentRevisionKey)
                    }
                  >
                    Archive
                  </Button>
                </HStack>
              ) : null}
            </HStack>
          ))}
        </Stack>
        {canEdit ? (
          <Button mt="4" size="sm" onClick={onCreatePage}>
            New page
          </Button>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}
