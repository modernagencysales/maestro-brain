import {
  createContext,
  createElement,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type ElementType,
  type ReactNode,
} from "react";

import { Button, type ButtonProps, Dialog } from "@saas-ui/react";

export type ModalId = string;

type ModalControlProps = {
  open?: boolean;
  onOpenChange?: (details: { open: boolean }) => void;
};

type ManagedModalProps<C extends ElementType> = Omit<
  ComponentProps<C>,
  keyof ModalControlProps
>;

type ModalLifecycleOptions = {
  onClose?: () => void;
};

type OpenModalArgs<C extends ElementType> =
  Record<never, never> extends ManagedModalProps<C>
    ? [props?: ManagedModalProps<C>, options?: ModalLifecycleOptions]
    : [props: ManagedModalProps<C>, options?: ModalLifecycleOptions];

export type ConfirmOptions = {
  title: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  confirmProps?: ButtonProps;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
};

export type ModalsApi = {
  open: <C extends ElementType>(
    component: C,
    ...args: OpenModalArgs<C>
  ) => ModalId;
  close: (id: ModalId) => void;
  closeAll: () => void;
  confirm: (options: ConfirmOptions) => ModalId;
};

type ModalEntry = {
  id: ModalId;
  render: (close: () => void) => ReactNode;
  onClose?: () => void;
};

type ModalEntryInput = Omit<ModalEntry, "id">;

export function createModalController() {
  let nextId = 1;
  let entries: ModalEntry[] = [];
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((listener) => listener());

  return {
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add: (entry: ModalEntryInput) => {
      const id = `modal-${nextId++}`;
      entries = [...entries, { ...entry, id }];
      emit();
      return id;
    },
    close: (id: ModalId) => {
      const entry = entries.find((candidate) => candidate.id === id);
      entries = entries.filter((candidate) => candidate.id !== id);
      emit();
      entry?.onClose?.();
    },
    closeAll: () => {
      const currentEntries = entries;
      entries = [];
      emit();
      currentEntries.forEach((entry) => entry.onClose?.());
    },
  };
}

const ModalsContext = createContext<ModalsApi | null>(null);

function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  body,
  children,
  confirmProps,
  onConfirm,
  onCancel,
}: ConfirmOptions & ModalControlProps) {
  const { children: confirmLabel = "Confirm", ...buttonProps } =
    confirmProps ?? {};

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.CloseButton />
        </Dialog.Header>
        {body || children ? (
          <Dialog.Body>{body ?? children}</Dialog.Body>
        ) : null}
        <Dialog.Footer>
          <Button
            variant="ghost"
            onClick={() => {
              onCancel?.();
              onOpenChange?.({ open: false });
            }}
          >
            Cancel
          </Button>
          <Button
            colorPalette="red"
            {...buttonProps}
            onClick={async () => {
              await onConfirm?.();
              onOpenChange?.({ open: false });
            }}
          >
            {confirmLabel}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function ModalsProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<ReturnType<typeof createModalController>>(null);
  if (!controllerRef.current) {
    controllerRef.current = createModalController();
  }
  const controller = controllerRef.current;
  const entries = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const close = useCallback(
    (id: ModalId) => controller.close(id),
    [controller],
  );

  const closeAll = useCallback(() => controller.closeAll(), [controller]);

  const open = useCallback(
    <C extends ElementType>(
      component: C,
      ...[props, options]: OpenModalArgs<C>
    ) => {
      return controller.add({
        onClose: options?.onClose,
        render: (closeEntry) =>
          createElement(component, {
            ...(props ?? {}),
            open: true,
            onOpenChange: ({ open }: { open: boolean }) => {
              if (!open) closeEntry();
            },
          }),
      });
    },
    [controller],
  ) as ModalsApi["open"];

  const confirm = useCallback<ModalsApi["confirm"]>(
    (options) => open(ConfirmationDialog, options),
    [open],
  );

  const api = useMemo<ModalsApi>(
    () => ({ open, close, closeAll, confirm }),
    [close, closeAll, confirm, open],
  );

  return (
    <ModalsContext.Provider value={api}>
      {children}
      {entries.map((entry) => (
        <Fragment key={entry.id}>
          {entry.render(() => close(entry.id))}
        </Fragment>
      ))}
    </ModalsContext.Provider>
  );
}

export function useModals() {
  const modals = useContext(ModalsContext);
  if (!modals) {
    throw new Error("useModals must be used within ModalsProvider");
  }
  return modals;
}
