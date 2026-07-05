import { useEffect, useState } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

type MotionQueryList = {
  readonly matches: boolean;
  readonly addEventListener?: (
    type: "change",
    listener: (event: { readonly matches: boolean }) => void,
  ) => void;
  readonly removeEventListener?: (
    type: "change",
    listener: (event: { readonly matches: boolean }) => void,
  ) => void;
  readonly addListener?: (
    listener: (event: { readonly matches: boolean }) => void,
  ) => void;
  readonly removeListener?: (
    listener: (event: { readonly matches: boolean }) => void,
  ) => void;
};

const readReducedMotionPreference = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(reducedMotionQuery).matches;

const addMotionPreferenceListener = (
  query: MotionQueryList,
  listener: (event: { readonly matches: boolean }) => void,
): (() => void) => {
  if (query.addEventListener && query.removeEventListener) {
    query.addEventListener("change", listener);
    return () => query.removeEventListener?.("change", listener);
  }

  query.addListener?.(listener);
  return () => query.removeListener?.(listener);
};

export const shouldAnimateWorkflowEdge = ({
  edgeAnimated,
  reducedMotion,
}: {
  readonly edgeAnimated: boolean;
  readonly reducedMotion: boolean;
}): boolean => edgeAnimated && !reducedMotion;

export function useWorkflowReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState<boolean>(
    readReducedMotionPreference,
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const query = window.matchMedia(reducedMotionQuery);
    const updateReducedMotion = (event: { readonly matches: boolean }) =>
      setReducedMotion(event.matches);

    setReducedMotion(query.matches);

    return addMotionPreferenceListener(query, updateReducedMotion);
  }, []);

  return reducedMotion;
}
