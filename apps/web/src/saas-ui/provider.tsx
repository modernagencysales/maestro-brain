import type { PropsWithChildren } from "react";

import { AppProvider } from "../features/common/providers/app-provider";

/** Test compatibility alias; the runtime provider authority is AppProvider. */
export function MaestroSaasUiProvider({ children }: PropsWithChildren) {
  return <AppProvider>{children}</AppProvider>;
}
