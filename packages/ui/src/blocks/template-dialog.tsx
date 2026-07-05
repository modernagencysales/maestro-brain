import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const focusableElementsInside = (root: HTMLElement): readonly HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true",
  );

const focusFirstDialogElement = (
  dialog: HTMLElement,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void => {
  const initialFocus = initialFocusRef?.current;

  if (initialFocus) {
    initialFocus.focus({ preventScroll: true });
    return;
  }

  const [firstFocusable] = focusableElementsInside(dialog);
  (firstFocusable ?? dialog).focus({ preventScroll: true });
};

const focusFallbackDialogTarget = (
  event: KeyboardEvent,
  dialog: HTMLElement,
): void => {
  event.preventDefault();
  dialog.focus({ preventScroll: true });
};

const wrappedTabTarget = ({
  first,
  last,
  shiftKey,
}: {
  readonly first: HTMLElement;
  readonly last: HTMLElement;
  readonly shiftKey: boolean;
}): HTMLElement | null => {
  const activeElement = document.activeElement;

  if (shiftKey) {
    return activeElement === first ? last : null;
  }

  return activeElement === last ? first : null;
};

const focusWrappedTabTarget = ({
  event,
  target,
}: {
  readonly event: KeyboardEvent;
  readonly target: HTMLElement | null;
}): void => {
  if (target) {
    event.preventDefault();
    target.focus({ preventScroll: true });
  }
};

const trapTabKey = (event: KeyboardEvent, dialog: HTMLElement): void => {
  if (event.key !== "Tab") {
    return;
  }

  const focusableElements = focusableElementsInside(dialog);
  const first = focusableElements[0];
  const last = focusableElements.at(-1);

  if (!first || !last) {
    focusFallbackDialogTarget(event, dialog);
    return;
  }

  focusWrappedTabTarget({
    event,
    target: wrappedTabTarget({ first, last, shiftKey: event.shiftKey }),
  });
};

const captureReturnFocus = (
  returnFocusRef: RefObject<HTMLElement | null>,
): void => {
  returnFocusRef.current =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
};

const returnFocusToCapturedElement = (
  returnFocusRef: RefObject<HTMLElement | null>,
): void => {
  returnFocusRef.current?.focus({ preventScroll: true });
  returnFocusRef.current = null;
};

const openDialogElement = (
  isOpen: boolean,
  dialogRef: RefObject<HTMLDivElement | null>,
): HTMLDivElement | null => (isOpen ? dialogRef.current : null);

const setupTemplateDialogFocusTrap = ({
  dialogRef,
  initialFocusRef,
  isOpen,
  onCloseRef,
  returnFocusRef,
}: {
  readonly dialogRef: RefObject<HTMLDivElement | null>;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly isOpen: boolean;
  readonly onCloseRef: RefObject<() => void>;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}): (() => void) | undefined => {
  const dialog = openDialogElement(isOpen, dialogRef);

  if (!dialog) {
    return undefined;
  }

  captureReturnFocus(returnFocusRef);
  focusFirstDialogElement(dialog, initialFocusRef);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
    } else {
      trapTabKey(event, dialog);
    }
  };

  document.addEventListener("keydown", handleKeyDown);

  return () => {
    document.removeEventListener("keydown", handleKeyDown);
    returnFocusToCapturedElement(returnFocusRef);
  };
};

export function useTemplateDialogFocusTrap({
  initialFocusRef,
  isOpen,
  onClose,
}: {
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(
    () =>
      setupTemplateDialogFocusTrap({
        dialogRef,
        isOpen,
        onCloseRef,
        returnFocusRef,
        ...(initialFocusRef ? { initialFocusRef } : {}),
      }),
    [initialFocusRef, isOpen],
  );

  return dialogRef;
}

export function TemplateDialog({
  children,
  description,
  initialFocusRef,
  isOpen,
  onClose,
  title,
}: {
  readonly children: ReactNode;
  readonly description?: string;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useTemplateDialogFocusTrap({
    isOpen,
    onClose,
    ...(initialFocusRef ? { initialFocusRef } : {}),
  });

  if (!isOpen) {
    return null;
  }

  return (
    <div className="template-dialog-backdrop" role="presentation">
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="template-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="template-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            aria-label={`Close ${title}`}
            className="template-dialog-close"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </header>
        <div className="template-dialog-body">{children}</div>
      </div>
    </div>
  );
}
