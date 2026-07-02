import { useCallback, useRef, type ReactNode } from "react";

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
  message,
}: {
  readonly children: ReactNode;
  readonly message?: string;
}) {
  return (
    <>
      {children}
      <div aria-live="polite" className="template-toast-region">
        {message ? (
          <div className="template-toast" role="status">
            {message}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function TemplateRoutePending({
  label = "Loading page",
}: {
  readonly label?: string;
}) {
  return (
    <main className="template-route-state" role="status">
      <p>{label}</p>
    </main>
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
    <main className="template-route-state error" role="alert">
      <h1>{title}</h1>
      <p>{description}</p>
    </main>
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
