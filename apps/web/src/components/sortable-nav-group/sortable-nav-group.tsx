import React from "react";

import {
  Box,
  type HTMLChakraProps,
  Portal,
  createIcon,
} from "@chakra-ui/react";
import {
  DndContext,
  DndContextProps,
  DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  UniqueIdentifier,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Sidebar } from "@saas-ui/react/sidebar";

export interface SortableNavGroupProps<Item = unknown>
  extends
    Omit<HTMLChakraProps<"div">, "onDragStart" | "onDragEnd" | "onDragOver">,
    DndContextProps {
  items: Item[];
  onSorted?: (fn: (items: Item[]) => Item[]) => void;
}
export const SortableNavGroup = <Item,>(props: SortableNavGroupProps<Item>) => {
  const {
    children,
    onDragStart,
    onDragOver,
    onDragEnd,
    onSorted,
    items,
    ...rest
  } = props;

  const [activeId, setActiveId] = React.useState<UniqueIdentifier | null>(null);
  const activeIndex = findItemIndex(items, activeId);
  const activeItem = findActiveItem(children, activeId);
  const sensors = useNavigationSensors();

  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragStart={(event) =>
        startNavigationDrag(event, setActiveId, onDragStart)
      }
      onDragOver={onDragOver}
      onDragEnd={(event) => {
        finishNavigationDrag(event, activeIndex, items, onSorted);
        setActiveId(null);
        onDragEnd?.(event);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext
        items={items as Array<UniqueIdentifier | { id: UniqueIdentifier }>}
        strategy={verticalListSortingStrategy}
      >
        <Sidebar.GroupContent {...rest}>{children}</Sidebar.GroupContent>
      </SortableContext>
      <NavigationDragOverlay activeItem={activeItem} />
    </DndContext>
  );
};

const useNavigationSensors = () =>
  useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { delay: 100, tolerance: 0 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

const findItemIndex = <Item,>(items: Item[], id: UniqueIdentifier | null) =>
  id
    ? items.findIndex((item) => (item as { id?: UniqueIdentifier }).id === id)
    : -1;

const findActiveItem = (
  children: React.ReactNode,
  activeId: UniqueIdentifier | null,
) =>
  React.Children.toArray(children).find((child) => {
    if (!React.isValidElement(child)) return false;
    const childProps = child.props as { id?: UniqueIdentifier };
    return child.type === SortableNavItem && childProps.id === activeId;
  }) as React.ReactElement<Sidebar.NavItemProps> | undefined;

const startNavigationDrag = (
  event: Parameters<NonNullable<DndContextProps["onDragStart"]>>[0],
  setActiveId: React.Dispatch<React.SetStateAction<UniqueIdentifier | null>>,
  onDragStart: DndContextProps["onDragStart"],
) => {
  if (!event.active) return;
  setActiveId(event.active.id);
  onDragStart?.(event);
};

const finishNavigationDrag = <Item,>(
  event: DragEndEvent,
  activeIndex: number,
  items: Item[],
  onSorted: SortableNavGroupProps<Item>["onSorted"],
) => {
  if (!event.over) return;
  const overIndex = findItemIndex(items, event.over.id);
  if (activeIndex !== overIndex)
    onSorted?.((items) => arrayMove(items, activeIndex, overIndex));
};

const NavigationDragOverlay = ({
  activeItem,
}: {
  activeItem?: React.ReactElement<Sidebar.NavItemProps>;
}) => (
  <Portal>
    <DragOverlay
      dropAnimation={{
        duration: 50,
        sideEffects: defaultDropAnimationSideEffects({
          styles: { active: { opacity: "0.2" } },
        }),
      }}
    >
      {activeItem ? (
        <Sidebar.NavItem {...activeItem.props}>
          <Sidebar.NavButton
            my="0"
            _hover={{ bg: "transparent" }}
            opacity="0.8"
          />
        </Sidebar.NavItem>
      ) : null}
    </DragOverlay>
  </Portal>
);

export interface SortableNavItemProps extends Sidebar.NavItemProps {
  id: string;
}

export const SortableNavItem: React.FC<SortableNavItemProps> = (props) => {
  const { id, children, ...rest } = props;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    transition: { duration: 150, easing: "cubic-bezier(0.25, 1, 0.5, 1)" },
  });

  const itemProps = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
    ...attributes,
    ...listeners,
  };

  return (
    <Sidebar.NavItem
      ref={setNodeRef}
      {...rest}
      {...itemProps}
      transitionProperty={
        isDragging || !!transform ? "background, transform" : "background"
      }
      data-dragging={isDragging || !!transform}
      data-sortable
      css={[
        {
          userSelect: "none",
          WebkitUserDrag: "none",
          ps: 2,
          ms: 1,
        },
        rest.css,
      ]}
    >
      <Box
        display="none"
        pos="absolute"
        left="-13px"
        top="50%"
        transform="translateY(-50%)"
        color="muted"
        opacity="0.6"
        cursor="grab"
        data-drag-handle=""
        css={{
          "[data-sortable]:hover &": { display: "block" },
          "[data-dragging] &": { display: "none" },
        }}
      >
        <GripIcon />
      </Box>
      {children}
    </Sidebar.NavItem>
  );
};

/**
 * Copied from Lucide Icons
 * https://lucide.dev
 */
const GripIcon = createIcon({
  displayName: "GripIcon",
  viewBox: "0 0 24 24",
  path: (
    <g fill="currentColor">
      <circle cx="9" cy="12" r="1"></circle>
      <circle cx="9" cy="5" r="1"></circle>
      <circle cx="9" cy="19" r="1"></circle>
      <circle cx="15" cy="12" r="1"></circle>
      <circle cx="15" cy="5" r="1"></circle>
      <circle cx="15" cy="19" r="1"></circle>
    </g>
  ),
});
