"use client";

import * as React from "react";

import { Box, Group, HStack, Spacer } from "@chakra-ui/react";
import { useDebouncedCallback } from "@react-hookz/web";
import {
  ActiveFiltersList,
  ColumnFiltersState,
  DataGrid,
  DataGridCell,
  DataGridPagination,
  Filter,
  FiltersProvider,
  NoFilteredResults,
  ResetFilters,
  Row,
  TableInstance,
  getDataGridFilter,
  useColumnVisibility,
  useColumns,
  useFiltersContext,
} from "@saas-ui-pro/react";
import {
  Button,
  ButtonGroup,
  Command,
  DataList,
  EmptyState,
  Flex,
  Popover,
  Select,
  Text,
  Tooltip,
  createListCollection,
} from "@saas-ui/react";
import { ActionBar, Page } from "@saas-ui/react";
import { useHotkeys, useHotkeysShortcut } from "@saas-ui/use-hotkeys";
import { TableState } from "@tanstack/react-table";
import { format } from "date-fns";
import { LuSlidersHorizontal, LuSquareUser } from "react-icons/lu";
import { z } from "zod";

import { ContactDTO } from "@workspace/api/types";
import { DataBoard, type DataBoardProps } from "@workspace/ui/data-board";
import { useDataGridFocus } from "@workspace/ui/hooks";
import { InlineSearch } from "@workspace/ui/inline-search";
import { useModals } from "@workspace/ui/modals";
import { OverflowMenu } from "@workspace/ui/overflow-menu";

import { Link } from "#components/link";
import { useCurrentWorkspace } from "#features/common/hooks/use-current-workspace";
import { api } from "#lib/trpc/react";
import { useUserSettings } from "#lib/user-settings/use-user-settings";

import { ContactAvatar } from "../common/contact-avatar";
import { ContactStatus } from "../common/contact-status";
import { ContactTag } from "../common/contact-tag";
import { ContactType } from "../common/contact-type";
import { AddPersonDialog } from "./add-person-dialog";
import { ContactBoardHeader } from "./contact-board-header";
import { bulkActions } from "./contact-bulk-actions";
import { ContactCard } from "./contact-card";
import { AddFilterButton, useContactFilters } from "./contact-filters";
import { ContactTypes } from "./contact-types";

function TrackDefaultFilters({
  defaultFilters,
}: {
  defaultFilters?: Filter[];
}) {
  const { enableFilter, activeFilters } = useFiltersContext();

  React.useEffect(() => {
    defaultFilters?.forEach((filter) => {
      const key = activeFilters?.find(({ id }) => id === filter.id)?.key;
      enableFilter(key ? { key, ...filter } : filter);
    });
  }, [defaultFilters]);

  return null;
}

const DateCell = ({ date }: { date?: string | Date | null }) => {
  return <>{date ? format(new Date(date), "PP") : null}</>;
};

const ActionCell: DataGridCell<ContactDTO> = (cell) => {
  return (
    <Box onClick={(e) => e.stopPropagation()}>
      <OverflowMenu.Root>
        <OverflowMenu.Item
          value="delete"
          onClick={() => console.log(cell.row.id)}
        >
          Delete
        </OverflowMenu.Item>
      </OverflowMenu.Root>
    </Box>
  );
};

const getType = (type?: "leads" | "customers") => {
  switch (type) {
    case "leads":
      return "lead";
    case "customers":
      return "customer";
  }
};

const useContactColumns = () =>
  useColumns<ContactDTO>(
    (helper) => [
      helper.accessor("name", {
        header: "Name",
        size: 200,
        enableHiding: false,
        cell: (cell) => (
          <HStack gap="4">
            <ContactAvatar contact={cell.row.original} size="xs" />
            <Link
              to="/contacts/$contactId"
              params={{ contactId: cell.row.original.id }}
            >
              {cell.getValue()}
            </Link>
          </HStack>
        ),
      }),
      helper.accessor("email", {
        header: "Email",
        size: 300,
        cell: (cell) => <Text color="muted">{cell.getValue()}</Text>,
      }),
      helper.accessor("createdAt", {
        header: "Created at",
        cell: (cell) => <DateCell date={cell.getValue()} />,
        filterFn: getDataGridFilter("date"),
        enableGlobalFilter: false,
      }),
      helper.accessor("updatedAt", {
        header: "Updated at",
        cell: (cell) => <DateCell date={cell.getValue()} />,
        filterFn: getDataGridFilter("date"),
        enableGlobalFilter: false,
      }),
      helper.accessor("type", {
        header: "Type",
        cell: (cell) => <ContactType type={cell.getValue()} />,
        filterFn: getDataGridFilter("string"),
        enableGlobalFilter: false,
      }),
      helper.accessor("tags", {
        header: "Tags",
        cell: (cell) => (
          <HStack>
            {cell.getValue()?.map((tag) => (
              <ContactTag key={tag} tag={tag} />
            ))}
          </HStack>
        ),
        filterFn: getDataGridFilter("string"),
        enableGlobalFilter: false,
      }),
      helper.accessor("status", {
        header: "Status",
        cell: (cell) => (
          <ContactStatus status={cell.getValue()} color="muted" />
        ),
        filterFn: getDataGridFilter("string"),
        enableGlobalFilter: false,
      }),
      helper.display({
        id: "action",
        header: "",
        cell: ActionCell,
        size: 60,
        enableGlobalFilter: false,
        enableHiding: false,
        enableSorting: false,
        enableGrouping: false,
        enableResizing: false,
      }),
    ],
    [],
  );

export const paramsSchema = z.object({
  workspace: z.string(),
  type: z.enum(["leads", "customers"]).optional(),
  tag: z.string().optional(),
});

export function ContactsListPage({
  params,
}: {
  params: {
    workspace: string;
    type?: "leads" | "customers";
    tag?: string;
  };
}) {
  const modals = useModals();

  const [searchQuery, setSearchQuery] = React.useState("");

  const type = getType(params.type);

  const [workspace] = useCurrentWorkspace();

  const [userSettings] = useUserSettings();

  const { data, isLoading } = api.contacts.listByType.useQuery({
    workspaceId: workspace.id,
    type,
  });

  const updateContactMutation = api.contacts.update.useMutation();

  const filters = useContactFilters();

  const columns = useContactColumns();

  const addPerson = () => {
    modals.open(AddPersonDialog, {
      type: type ?? "lead",
    });
  };

  const addCommand = useHotkeysShortcut("contacts.add", addPerson);

  const [groupBy, setGroupBy] = React.useState("status");

  const visibleColumns = userSettings.contactsColumns ?? [
    "name",
    "email",
    "createdAt",
    "type",
    "status",
  ];

  const groupCollection = createListCollection({
    items: [
      { value: "status", label: "Status" },
      { value: "type", label: "Type" },
      { value: "tags", label: "Tag" },
    ],
  });

  const groupBySelect = (
    <Select.Root
      name="groupBy"
      value={[groupBy]}
      collection={groupCollection}
      onValueChange={({ value }) => setGroupBy(value[0] as string)}
      size="xs"
    >
      <Select.Trigger>
        <Select.ValueText placeholder="Group by" />
      </Select.Trigger>

      <Select.Content portalled={false}>
        {groupCollection.items.map((item) => (
          <Select.Item key={item.value} item={item}>
            {item.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );

  const primaryAction = (
    <Tooltip
      portalled
      content={
        <>
          Add person <Command>{addCommand}</Command>
        </>
      }
    >
      <Button
        variant="solid"
        colorPalette="accent"
        size="xs"
        onClick={addPerson}
      >
        Add person
      </Button>
    </Tooltip>
  );

  const [showSearch, setShowSearch] = React.useState(false);

  useHotkeys("cmd+f", () => setShowSearch((prev) => !prev), {
    preventDefault: true,
  });

  const displayProperties = <div />;

  const toolbar = (
    <ButtonGroup>
      <ContactTypes />
      <Spacer />
      {showSearch && (
        <InlineSearch
          ref={(el) => {
            el?.focus();
          }}
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onReset={() => {
            setSearchQuery("");
            setShowSearch(false);
          }}
        />
      )}
      {primaryAction}
    </ButtonGroup>
  );

  const tabbar = (
    <ButtonGroup py="2">
      <Flex flex="1" flexWrap="wrap" gap="2" alignItems="center">
        <ActiveFiltersList size="xs" variant="surface" />
        <AddFilterButton />
      </Flex>
      <Popover.Root
        size="sm"
        positioning={{
          placement: "bottom-end",
        }}
      >
        <Popover.Trigger asChild>
          <Button size="xs">
            <LuSlidersHorizontal />
            Display
          </Button>
        </Popover.Trigger>

        <Popover.Content maxW="260px">
          <Popover.Body borderBottomWidth="1px">
            <DataList.Root orientation="horizontal">
              <DataList.Item>
                <DataList.ItemLabel>Group by</DataList.ItemLabel>
                <DataList.ItemValue justifyContent="flex-end">
                  {groupBySelect}
                </DataList.ItemValue>
              </DataList.Item>
            </DataList.Root>
          </Popover.Body>
          <Popover.Body>
            <DataList.Root>
              <DataList.Item>
                <DataList.ItemLabel>Display properties</DataList.ItemLabel>
                <DataList.ItemValue>{displayProperties}</DataList.ItemValue>
              </DataList.Item>
            </DataList.Root>
          </Popover.Body>
        </Popover.Content>
      </Popover.Root>
    </ButtonGroup>
  );

  let defaultFilters: Filter[] = [];

  if (params?.tag) {
    defaultFilters = [{ id: "tags", operator: "contains", value: params.tag }];
  }

  const emptyState = (
    <EmptyState
      title="No people added yet"
      description="Add a person or import data to get started."
      icon={<LuSquareUser />}
      height="full"
    >
      <Button variant="solid" colorPalette="accent" onClick={addPerson}>
        Add a person
      </Button>
      <Button>Import data</Button>
    </EmptyState>
  );

  // Composed page state (replacing ListPage)
  const gridRef = React.useRef<TableInstance<ContactDTO>>(null);
  const boardRef = React.useRef<TableInstance<ContactDTO>>(null);

  const [selections, setSelections] = React.useState<string[]>([]);

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [globalFilter, setGlobalFilter] = React.useState("");

  const { onFocusChange, containerRef } = useDataGridFocus<ContactDTO>();

  const onFilter = React.useCallback((newFilters: Filter[]) => {
    setColumnFilters(
      newFilters.map((filter) => ({
        id: filter.id,
        value: {
          value: filter.value,
          operator: filter.operator,
        },
      })) as ColumnFiltersState,
    );
  }, []);

  const onSearch = useDebouncedCallback(setGlobalFilter, [], 100);

  React.useEffect(() => {
    onSearch(searchQuery || "");
  }, [searchQuery, onSearch]);

  const onBeforeEnableFilter = React.useCallback(
    (activeFilter: Filter): Promise<Filter> => Promise.resolve(activeFilter),
    [],
  );

  const columnVisibility = useColumnVisibility({
    columns,
    visibleColumns,
  });

  const state: Partial<TableState> = {
    columnVisibility,
    columnFilters,
    globalFilter,
  };

  const getRowId = (row: ContactDTO, index: number, parent?: Row<ContactDTO>) =>
    row.id || `${parent ? [parent.id, index].join(".") : index}`;

  const onRowClick = (_row: Row<ContactDTO>, e: React.MouseEvent) => {
    const link: HTMLAnchorElement | null =
      e.currentTarget.querySelector("td a");
    link?.click();
  };

  const view = userSettings.contactsView ?? "list";
  const contacts = data?.contacts ?? [];

  let content: React.ReactNode;

  if (!contacts.length) {
    content = (
      <Box p="20" height="full">
        {emptyState}
      </Box>
    );
  } else if (view === "board") {
    content = (
      <Box height="100%" width="100%" bg="page-body-bg-subtle">
        <DataBoard<ContactDTO>
          instanceRef={boardRef}
          px="6"
          height="100%"
          columns={columns}
          data={contacts}
          renderHeader={(header) => <ContactBoardHeader {...header} />}
          renderCard={(row) => <ContactCard contact={row.original} />}
          groupBy={userSettings.contactsGroupBy}
          onCardDragEnd={(event) =>
            handleContactCardDragEnd(
              event,
              contacts,
              workspace.id,
              updateContactMutation.mutateAsync,
            )
          }
          noResults={NoFilteredResults}
          getRowId={getRowId}
          initialState={{
            columnVisibility,
            pagination: { pageSize: 20 },
            columnPinning: {
              left: ["selection", "name"],
              right: ["action"],
            },
          }}
          state={state}
        />
      </Box>
    );
  } else {
    content = (
      <DataGrid<ContactDTO>
        ref={containerRef}
        instanceRef={gridRef}
        columns={columns}
        data={contacts}
        isSelectable
        isSortable
        isHoverable
        columnResizeEnabled
        onSelectedRowsChange={setSelections}
        onRowClick={onRowClick}
        onFocusChange={onFocusChange}
        onColumnFiltersChange={setColumnFilters}
        noResults={NoFilteredResults}
        getRowId={getRowId}
        initialState={{
          columnVisibility,
          pagination: { pageSize: 20 },
          columnPinning: {
            left: ["selection", "name"],
            right: ["action"],
          },
        }}
        state={state}
      >
        <DataGridPagination.Root borderTopWidth="1px" siblingCount={3}>
          <DataGridPagination.PageControl />
          <DataGridPagination.PreviousButton />
          <DataGridPagination.Items />
          <DataGridPagination.NextButton />
        </DataGridPagination.Root>
      </DataGrid>
    );
  }

  const stickyStyles = {
    position: "sticky" as const,
    zIndex: 1,
    bg: "chakra-body-bg",
    borderWidth: 0,
  };

  return (
    <FiltersProvider
      filters={filters}
      onChange={onFilter}
      onBeforeEnableFilter={onBeforeEnableFilter}
    >
      <TrackDefaultFilters defaultFilters={defaultFilters} />
      <Page.Root
        position="relative"
        loading={isLoading}
        css={{
          "& thead": {
            ...stickyStyles,
            boxShadow: "xs",
            _dark: {
              boxShadow: "sm",
            },
          },
          "& .sui-data-grid__pagination": {
            ...stickyStyles,
            bottom: 0,
            borderTopWidth: "1px",
          },
          "& tbody tr": {
            cursor: "pointer",
          },
          "& tbody tr a:hover": {
            textDecoration: "none",
          },
          "& tbody tr:last-of-type td": {
            borderBottomWidth: 0,
          },
        }}
      >
        <Page.Header title="Contacts" actions={toolbar} footer={tabbar} />
        <ActionBar.Root open={selections.length > 0}>
          <ActionBar.Content portalled>
            <Group
              gap="0"
              border="1px dashed"
              borderRadius="md"
              borderColor="border"
            >
              <ActionBar.SelectionTrigger border="0">
                {selections.length} selected
              </ActionBar.SelectionTrigger>
              <ActionBar.CloseButton onClick={() => setSelections([])} />
            </Group>
            <ActionBar.Separator />
            <HStack flex="1" justify="flex-end">
              {bulkActions({ selections })}
            </HStack>
          </ActionBar.Content>
        </ActionBar.Root>
        <ActiveFiltersList size="sm" zIndex="4">
          <Spacer />
          <ResetFilters>Clear all</ResetFilters>
        </ActiveFiltersList>
        <Page.Body p="0">{content}</Page.Body>
      </Page.Root>
    </FiltersProvider>
  );
}

type ContactCardDragEvent = Parameters<
  NonNullable<DataBoardProps<ContactDTO>["onCardDragEnd"]>
>[0];

const handleContactCardDragEnd = (
  { from, items, to }: ContactCardDragEvent,
  contacts: ContactDTO[],
  workspaceId: string,
  mutate: ReturnType<typeof api.contacts.update.useMutation>["mutateAsync"],
) => {
  const contact = contacts.find(
    ({ id }) => id === items[to.columnId]?.[to.index],
  );
  if (!contact) throw new Error("Contact not found");
  const [field, toValue] = (to.columnId as string).split(":") as [
    keyof ContactDTO,
    string,
  ];
  const [, previousValue] = (from.columnId as string).split(":");
  const neighbors = adjacentContacts(contacts, items, to);
  const sortOrder = contactSortOrder(neighbors, contacts.length, to.index);
  const value = updatedContactField(contact, field, toValue, previousValue);
  mutate({ workspaceId, id: contact.id, [field]: value, sortOrder });
};

const adjacentContacts = (
  contacts: ContactDTO[],
  items: ContactCardDragEvent["items"],
  to: ContactCardDragEvent["to"],
) => {
  const previousId = items[to.columnId]?.[to.index - 1];
  const nextId = items[to.columnId]?.[to.index + 1];
  let previous = contacts.find(({ id }) => id === previousId);
  let next = contacts.find(({ id }) => id === nextId);
  const previousIndex = contacts.findIndex(({ id }) => id === previousId);
  if (previous && !next) next = contacts[previousIndex + 1];
  else if (!previous && !next) previous = contacts[previousIndex - 1];
  return { next, previous };
};

const contactSortOrder = (
  { next, previous }: ReturnType<typeof adjacentContacts>,
  contactCount: number,
  targetIndex: number,
) => {
  const previousSortOrder = previous?.sortOrder || 0;
  const nextSortOrder = next?.sortOrder ?? contactCount;
  return (previousSortOrder + nextSortOrder) / 2 || targetIndex;
};

const updatedContactField = (
  contact: ContactDTO,
  field: keyof ContactDTO,
  targetValue: string,
  previousValue: string,
): string | string[] => {
  if (!Array.isArray(contact[field])) return targetValue;
  const replacement = targetValue !== "" ? [targetValue] : [];
  return replacement.concat(
    (contact[field] as string[]).filter((value) => value !== previousValue),
  );
};
