import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type WorkspaceRole = "viewer" | "editor" | "admin" | "owner";

export type WorkspaceSummary = {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "archived";
};

export type WorkspaceProviderState =
  | {
      readonly status: "loading";
      readonly workspaces: readonly WorkspaceSummary[];
      readonly activeWorkspaceId: null;
      readonly activeWorkspace: null;
    }
  | {
      readonly status: "provisioning";
      readonly workspaces: readonly WorkspaceSummary[];
      readonly activeWorkspaceId: null;
      readonly activeWorkspace: null;
    }
  | {
      readonly status: "empty";
      readonly workspaces: readonly WorkspaceSummary[];
      readonly activeWorkspaceId: null;
      readonly activeWorkspace: null;
    }
  | {
      readonly status: "ready";
      readonly workspaces: readonly WorkspaceSummary[];
      readonly activeWorkspaceId: string;
      readonly activeWorkspace: WorkspaceSummary;
    }
  | {
      readonly status: "failure";
      readonly workspaces: readonly WorkspaceSummary[];
      readonly activeWorkspaceId: string | null;
      readonly activeWorkspace: WorkspaceSummary | null;
      readonly phase: "loading" | "provisioning";
      readonly message: string;
    };

export type WorkspaceOperations = {
  readonly loadWorkspaces: () => Promise<readonly WorkspaceSummary[]>;
  readonly ensureProvisioned: () => Promise<{ readonly workspaceId: string }>;
};

export type WorkspaceSelectionStorage = {
  readonly read: () => string | null;
  readonly write: (workspaceId: string) => void;
};

export type WorkspaceController = {
  readonly getSnapshot: () => WorkspaceProviderState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly initialize: () => Promise<void>;
  readonly switchWorkspace: (workspaceId: string) => void;
};

const loadingState: WorkspaceProviderState = {
  status: "loading",
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspace: null,
};

const WorkspaceContext = createContext<WorkspaceController | null>(null);

export const createWorkspaceController = (
  input: WorkspaceOperations & {
    readonly storage?: WorkspaceSelectionStorage;
  },
): WorkspaceController => {
  let state: WorkspaceProviderState = loadingState;
  const listeners = new Set<() => void>();

  const setState = (next: WorkspaceProviderState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const chooseWorkspace = (
    workspaces: readonly WorkspaceSummary[],
    preferredId: string | null,
  ): WorkspaceSummary | null =>
    workspaces.find((workspace) => workspace.workspaceId === preferredId) ??
    workspaces[0] ??
    null;

  const readyFrom = (
    workspaces: readonly WorkspaceSummary[],
    preferredId: string | null,
  ): WorkspaceProviderState => {
    const active = chooseWorkspace(workspaces, preferredId);
    if (active === null) {
      return {
        status: "empty",
        workspaces,
        activeWorkspaceId: null,
        activeWorkspace: null,
      };
    }
    input.storage?.write(active.workspaceId);
    return {
      status: "ready",
      workspaces,
      activeWorkspaceId: active.workspaceId,
      activeWorkspace: active,
    };
  };

  const initialize = async () => {
    setState(loadingState);

    let workspaces: readonly WorkspaceSummary[];
    try {
      workspaces = await input.loadWorkspaces();
    } catch (error) {
      setState(failureState("loading", error, [], null));
      return;
    }

    if (workspaces.length > 0) {
      setState(readyFrom(workspaces, input.storage?.read() ?? null));
      return;
    }

    setState({
      status: "provisioning",
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
    });

    let provisionedId: string;
    try {
      provisionedId = (await input.ensureProvisioned()).workspaceId;
    } catch (error) {
      setState(failureState("provisioning", error, [], null));
      return;
    }

    try {
      workspaces = await input.loadWorkspaces();
    } catch (error) {
      setState(failureState("loading", error, [], null));
      return;
    }

    setState(readyFrom(workspaces, provisionedId));
  };

  const switchWorkspace = (workspaceId: string) => {
    if (state.status !== "ready") return;
    const active = state.workspaces.find(
      (workspace) => workspace.workspaceId === workspaceId,
    );
    if (!active) return;
    input.storage?.write(active.workspaceId);
    setState({
      ...state,
      activeWorkspaceId: active.workspaceId,
      activeWorkspace: active,
    });
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize,
    switchWorkspace,
  };
};

export const WorkspaceProvider = ({
  children,
  controller,
  operations,
  storage,
}: {
  readonly children: ReactNode;
  readonly controller?: WorkspaceController;
  readonly operations?: WorkspaceOperations;
  readonly storage?: WorkspaceSelectionStorage;
}) => {
  const resolvedController = useMemo(() => {
    if (controller) return controller;
    if (!operations) {
      throw new Error("WorkspaceProvider requires operations or controller.");
    }
    return createWorkspaceController(
      storage === undefined ? operations : { ...operations, storage },
    );
  }, [controller, operations, storage]);

  useEffect(() => {
    void resolvedController.initialize();
  }, [resolvedController]);

  return (
    <WorkspaceContext.Provider value={resolvedController}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = (): WorkspaceProviderState & {
  readonly switchWorkspace: (workspaceId: string) => void;
} => {
  const controller = useContext(WorkspaceContext);
  if (controller === null) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  }
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  return {
    ...snapshot,
    switchWorkspace: controller.switchWorkspace,
  };
};

export const createBrowserWorkspaceStorage = (
  key = "maestro-template.activeWorkspaceId",
): WorkspaceSelectionStorage => ({
  read: () =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  write: (workspaceId) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, workspaceId);
    }
  },
});

const failureState = (
  phase: "loading" | "provisioning",
  error: unknown,
  workspaces: readonly WorkspaceSummary[],
  activeWorkspace: WorkspaceSummary | null,
): WorkspaceProviderState => ({
  status: "failure",
  phase,
  message:
    error instanceof Error ? error.message : "Workspace operation failed",
  workspaces,
  activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
  activeWorkspace,
});
