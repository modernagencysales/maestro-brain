"use client";

import React, { forwardRef, useMemo } from "react";

import {
  HTMLChakraProps,
  createContext,
  useControllableState,
} from "@chakra-ui/react";
import {
  Kanban,
  KanbanCard,
  KanbanColumn,
  KanbanColumnBody,
  KanbanColumnHeader,
  KanbanDragOverlay,
  KanbanItems,
  KanbanProps,
  UseKanbanContainerReturn,
} from "@saas-ui-pro/kanban";
import { DataGridProvider, NoResults } from "@saas-ui-pro/react";
import {
  ColumnDef,
  GroupingRow,
  GroupingState,
  Row,
  RowData,
  Table,
  TableOptions,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  useReactTable,
} from "@tanstack/react-table";

export const [DataBoardProvider, useDataBoardContext] =
  createContext<Table<object>>();

export type DataBoardHeaderProps = GroupingRow;

export interface DataBoardProps<Data extends object>
  extends
    Omit<HTMLChakraProps<"div">, "onChange" | "columns">,
    Omit<TableOptions<Data>, "getCoreRowModel">,
    Pick<KanbanProps, "onChange" | "onCardDragEnd" | "onColumnDragEnd"> {
  instanceRef?: React.Ref<Table<Data>>;
  data: Data[];
  columns: ColumnDef<Data>[];
  renderHeader?: (item: GroupingRow) => React.ReactNode;
  renderCard?: (item: Row<Data>) => React.ReactNode;
  groupBy?: string;
  defaultGroupBy?: string;
  onGroupChange?: (group: string) => void;
  /**
   * Callback fired when clear filters is clicked.
   */
  onResetFilters?: () => void;
  /**
   * No results component
   */
  noResults?: React.ElementType;
  hideEmptyColumns?: boolean;
}

export const DataBoard = forwardRef(function DataBoard<Data extends object>(
  props: DataBoardProps<Data>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  void ref;
  const {
    instanceRef,
    data,
    columns,
    groupBy,
    defaultGroupBy,
    onGroupChange,
    renderHeader = () => null,
    renderCard = () => null,
    onResetFilters,
    noResults: NoResultsComponent = NoResults,
    getRowId,
    initialState: initialStateProp,
    state: stateProp,
    hideEmptyColumns,
    ...rest
  } = props;

  const [grouping, setGrouping] = useControllableState<GroupingState>({
    defaultValue: useMemo(
      () => (defaultGroupBy ? [defaultGroupBy] : []),
      [defaultGroupBy],
    ),
    value: useMemo(() => (groupBy ? [groupBy] : []), [groupBy]),
    onChange: (grouping) => {
      onGroupChange?.(grouping[0]);
    },
  });

  const instance = useReactTable({
    data: React.useMemo(() => data, [data]),
    columns: React.useMemo(() => columns, [columns]),
    groupedColumnMode: false,
    onGroupingChange: setGrouping,
    getGroupedRowModel: getGroupedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId,
    initialState: React.useMemo(() => initialStateProp, [initialStateProp]),
    state: React.useMemo(
      () => ({
        ...stateProp,
        grouping,
      }),
      [stateProp, grouping],
    ),
    ...rest,
  });

  // This exposes the useReactTable api through the instanceRef
  React.useImperativeHandle(instanceRef, () => instance, [instance]);

  const state = instance.getState();

  const rows = instance.getRowModel().rows;

  const mapItems = React.useCallback(() => {
    return createKanbanItems(instance, groupBy);
  }, [groupBy, rows]);

  React.useEffect(() => {
    setItems(mapItems());
  }, [groupBy, rows]);

  const [items, setItems] = React.useState<KanbanItems>({});

  const board = (boardState: UseKanbanContainerReturn) => (
    <DataBoardColumns
      {...boardState}
      hideEmptyColumns={hideEmptyColumns}
      instance={instance}
      renderCard={renderCard}
      renderHeader={renderHeader}
    />
  );

  const noResults = renderNoResults({
    NoResultsComponent,
    onResetFilters,
    rows,
    state,
  });

  return (
    <DataGridProvider instance={instance}>
      <DataBoardProvider value={instance as unknown as Table<object>}>
        <Kanban items={items} onChange={setItems} {...rest}>
          {noResults || board}
        </Kanban>
      </DataBoardProvider>
    </DataGridProvider>
  );
}) as (<Data extends object>(
  props: DataBoardProps<Data> & {
    ref?: React.ForwardedRef<HTMLDivElement>;
  },
) => React.ReactElement) & { displayName?: string };

interface DataBoardColumnsProps<
  Data extends object,
> extends UseKanbanContainerReturn {
  hideEmptyColumns?: boolean;
  instance: Table<Data>;
  renderCard: (item: Row<Data>) => React.ReactNode;
  renderHeader: (item: GroupingRow) => React.ReactNode;
}

const DataBoardColumns = <Data extends object>({
  activeId,
  columns,
  hideEmptyColumns,
  instance,
  items,
  renderCard,
  renderHeader,
}: DataBoardColumnsProps<Data>) => (
  <>
    {columns.map((id) => (
      <DataBoardColumn<Data>
        hideEmptyColumns={hideEmptyColumns}
        id={id}
        instance={instance}
        items={items}
        key={id}
        renderCard={renderCard}
        renderHeader={renderHeader}
      />
    ))}
    <DataBoardOverlay<Data>
      activeId={activeId}
      instance={instance}
      renderCard={renderCard}
    />
  </>
);

const DataBoardColumn = <Data extends object>({
  hideEmptyColumns,
  id,
  instance,
  items,
  renderCard,
  renderHeader,
}: {
  hideEmptyColumns?: boolean;
  id: UseKanbanContainerReturn["columns"][number];
  instance: Table<Data>;
  items: KanbanItems;
  renderCard: (item: Row<Data>) => React.ReactNode;
  renderHeader: (item: GroupingRow) => React.ReactNode;
}) => {
  const row = instance.getRowModel().rowsById[id];
  if (!row && hideEmptyColumns) return null;
  const [groupingColumnId, groupingValue] = String(id).split(":");
  return (
    <KanbanColumn id={id} width="320px" px="4">
      <KanbanColumnHeader>
        {flexRender(
          renderHeader,
          row || { id, groupingValue, groupingColumnId },
        )}
      </KanbanColumnHeader>
      <KanbanColumnBody>
        {items[id]?.map((itemId) => (
          <BoardCard
            item={instance.getRowModel().rowsById[itemId]}
            key={itemId}
            render={renderCard}
          />
        ))}
      </KanbanColumnBody>
    </KanbanColumn>
  );
};

const DataBoardOverlay = <Data extends object>({
  activeId,
  instance,
  renderCard,
}: Pick<
  DataBoardColumnsProps<Data>,
  "activeId" | "instance" | "renderCard"
>) => (
  <KanbanDragOverlay>
    {activeId && (
      <KanbanCard id={activeId}>
        {renderCard(instance.getRowModel().rowsById[activeId])}
      </KanbanCard>
    )}
  </KanbanDragOverlay>
);

const renderNoResults = <Data extends object>({
  NoResultsComponent,
  onResetFilters,
  rows,
  state,
}: {
  NoResultsComponent: React.ElementType;
  onResetFilters?: () => void;
  rows: Row<Data>[];
  state: ReturnType<Table<Data>["getState"]>;
}) =>
  (state.columnFilters?.length || state.globalFilter) && !rows.length ? (
    <NoResultsComponent onReset={onResetFilters} />
  ) : null;

const createKanbanItems = <Data extends object>(
  instance: Table<Data>,
  groupBy?: string,
): KanbanItems => {
  const items = groupBy
    ? getColumns(instance.getPreFilteredRowModel().rows, groupBy)
    : {};
  instance.getRowModel().rows.forEach((row) => {
    if (row.getIsGrouped())
      items[row.id] = row.subRows.map((subRow) => subRow.id);
  });
  return items;
};

interface BoardCardProps<Data extends object> {
  item: Row<Data>;
  render: (item: Row<Data>) => React.ReactNode;
}

const BoardCardBase = <Data extends object>({
  item,
  render,
}: BoardCardProps<Data>) =>
  item ? (
    <KanbanCard key={item.id} id={item.id}>
      {flexRender(render, item)}
    </KanbanCard>
  ) : null;

const boardCardPropsEqual = <Data extends object>(
  previous: BoardCardProps<Data>,
  next: BoardCardProps<Data>,
) => previous.item?.original === next.item?.original;

const BoardCard = React.memo(
  BoardCardBase,
  boardCardPropsEqual,
) as typeof BoardCardBase;

function getColumns<TData extends RowData>(
  rows: Row<TData>[],
  groupBy: string,
) {
  return rows.reduce<KanbanItems>((columns, row) => {
    const resKey = `${groupBy}:${row.getGroupingValue(groupBy)}`;
    columns[resKey] = [];
    return columns;
  }, {});
}
