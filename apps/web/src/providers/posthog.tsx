import type { ReactNode } from "react";

export const PostHogWebProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => children;
