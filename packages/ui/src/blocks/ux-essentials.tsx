import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type TemplateToastTone = "neutral" | "success" | "warning" | "danger";

export type TemplateToast = {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly tone?: TemplateToastTone;
};

export type TemplateToastInput = Omit<TemplateToast, "id"> & {
  readonly autoDismissMs?: number;
  readonly id?: string;
};

export type TemplateToastApi = {
  readonly notify: (toast: TemplateToastInput) => string;
  readonly dismiss: (toastId: string) => void;
};

const TemplateToastContext = createContext<TemplateToastApi | null>(null);

const missingTemplateToastApi: TemplateToastApi = {
  dismiss: () => {},
  notify: () => "template-toast-missing-provider",
};

const initialTemplateToasts = ({
  initialToasts,
  message,
}: {
  readonly initialToasts: readonly TemplateToast[];
  readonly message: string | undefined;
}): readonly TemplateToast[] => {
  if (!message) {
    return initialToasts;
  }

  return [
    ...initialToasts,
    {
      id: "template-toast-static-message",
      title: message,
      tone: "neutral",
    },
  ];
};

const clearToastTimer = (
  timers: Map<string, ReturnType<typeof setTimeout>>,
  toastId: string,
): void => {
  const timer = timers.get(toastId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  timers.delete(toastId);
};

const clearAllToastTimers = (
  timers: Map<string, ReturnType<typeof setTimeout>>,
): void => {
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
};

const storeToast = (
  current: readonly TemplateToast[],
  toast: TemplateToast,
): readonly TemplateToast[] => [
  ...current.filter((existing) => existing.id !== toast.id),
  toast,
];

const useTemplateToastState = ({
  defaultAutoDismissMs,
  initialToasts,
  message,
}: {
  readonly defaultAutoDismissMs: number;
  readonly initialToasts: readonly TemplateToast[];
  readonly message: string | undefined;
}) => {
  const nextId = useRef(0);
  const dismissTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const [toasts, setToasts] = useState<readonly TemplateToast[]>(() =>
    initialTemplateToasts({ initialToasts, message }),
  );

  const dismiss = useCallback((toastId: string) => {
    clearToastTimer(dismissTimers.current, toastId);
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const notify = useCallback(
    (toast: TemplateToastInput) => {
      const { autoDismissMs = defaultAutoDismissMs, ...storedToast } = toast;
      const id = toast.id ?? `template-toast-${nextId.current++}`;

      clearToastTimer(dismissTimers.current, id);
      setToasts((current) => storeToast(current, { ...storedToast, id }));

      if (autoDismissMs > 0) {
        dismissTimers.current.set(
          id,
          setTimeout(() => dismiss(id), autoDismissMs),
        );
      }

      return id;
    },
    [defaultAutoDismissMs, dismiss],
  );

  useEffect(
    () => () => {
      clearAllToastTimers(dismissTimers.current);
    },
    [],
  );

  const api = useMemo<TemplateToastApi>(
    () => ({
      dismiss,
      notify,
    }),
    [dismiss, notify],
  );

  return { api, dismiss, toasts };
};

export function TemplateSkipLink({
  targetId = "template-main-content",
  children = "Skip to content",
}: {
  readonly targetId?: string;
  readonly children?: ReactNode;
}) {
  return (
    <a className="template-skip-link" href={`#${targetId}`}>
      {children}
    </a>
  );
}

export function TemplateLiveRegion({ message }: { readonly message: string }) {
  return (
    <div aria-live="polite" className="template-live-region" role="status">
      {message}
    </div>
  );
}

export function TemplateNetworkBanner({
  state,
}: {
  readonly state: "online" | "offline" | "degraded";
}) {
  if (state === "online") {
    return null;
  }

  return (
    <div className={`template-network-banner ${state}`} role="status">
      {state === "offline"
        ? "You are offline. Local draft state remains available."
        : "Network is degraded. Live provider calls may be delayed."}
    </div>
  );
}

export function TemplateRouteFocusBoundary({
  announcement,
  children,
  focusKey,
  networkState = "online",
  targetId = "template-main-content",
}: {
  readonly announcement: string;
  readonly children: ReactNode;
  readonly focusKey: string;
  readonly networkState?: "online" | "offline" | "degraded";
  readonly targetId?: string;
}) {
  useEffect(() => {
    const focusTarget = () => {
      const target = document.getElementById(targetId);

      if (target instanceof HTMLElement) {
        target.focus({ preventScroll: true });
      }
    };

    focusTarget();
    const settledFocus = window.setTimeout(focusTarget, 175);

    return () => window.clearTimeout(settledFocus);
  }, [focusKey, targetId]);

  return (
    <>
      <TemplateSkipLink targetId={targetId} />
      <TemplateLiveRegion message={announcement} />
      <TemplateNetworkBanner state={networkState} />
      {children}
    </>
  );
}

export function TemplateMainContent({
  children,
  className,
  id = "template-main-content",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly id?: string;
}) {
  return (
    <main className={className} id={id} tabIndex={-1}>
      {children}
    </main>
  );
}

export function TemplateEmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <section className="template-empty-state" aria-label={title}>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </section>
  );
}

export function TemplateToastProvider({
  children,
  defaultAutoDismissMs = 5000,
  initialToasts = [],
  message,
}: {
  readonly children: ReactNode;
  readonly defaultAutoDismissMs?: number;
  readonly initialToasts?: readonly TemplateToast[];
  readonly message?: string;
}) {
  const { api, dismiss, toasts } = useTemplateToastState({
    defaultAutoDismissMs,
    initialToasts,
    message,
  });

  return (
    <TemplateToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="template-toast-region">
        {toasts.map((toast) => (
          <div
            className={`template-toast ${toast.tone ?? "neutral"}`}
            key={toast.id}
            role="status"
          >
            <div>
              <strong>{toast.title}</strong>
              {toast.description ? <p>{toast.description}</p> : null}
            </div>
            <button
              aria-label={`Dismiss ${toast.title}`}
              onClick={() => dismiss(toast.id)}
              type="button"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </TemplateToastContext.Provider>
  );
}

export function useTemplateToast(): TemplateToastApi {
  return useContext(TemplateToastContext) ?? missingTemplateToastApi;
}

export function TemplateRoutePending({
  label = "Loading page",
}: {
  readonly label?: string;
}) {
  return (
    <TemplateMainContent className="template-route-state">
      <div role="status">
        <p>{label}</p>
      </div>
    </TemplateMainContent>
  );
}

export function TemplateRouteError({
  title = "Something went wrong",
  description = "The page could not be loaded. Try again or return to a safe workspace page.",
}: {
  readonly title?: string;
  readonly description?: string;
}) {
  return (
    <TemplateMainContent className="template-route-state error">
      <div role="alert">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </TemplateMainContent>
  );
}

export function useTemplateFocusReturn() {
  const lastFocused = useRef<HTMLElement | null>(null);

  const captureFocus = useCallback(() => {
    lastFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, []);

  const returnFocus = useCallback(() => {
    lastFocused.current?.focus();
  }, []);

  return { captureFocus, returnFocus };
}
