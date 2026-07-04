export type PrimitiveSurface =
  "web" | "api" | "cli" | "mcp" | "workflow" | "internal";

export type PrimitiveRuntime =
  | "domain"
  | "confect-query"
  | "confect-mutation"
  | "confect-action"
  | "convex-workflow"
  | "frontend-view-model"
  | "editor";

export type PrimitiveFileKind =
  | "domain"
  | "schema"
  | "spec"
  | "impl"
  | "workflow-handler"
  | "frontend-state"
  | "frontend-adapter"
  | "manifest"
  | "test"
  | "docs"
  | "quality-gate";

export type PrimitiveContractFile = {
  readonly path: string;
  readonly kind: PrimitiveFileKind;
};

export type PrimitiveContract = {
  readonly name: string;
  readonly namespace: string;
  readonly version: number;
  readonly runtimes: readonly PrimitiveRuntime[];
  readonly surfaces: readonly PrimitiveSurface[];
  readonly hasInternalWorkflowStep: boolean;
  readonly uiStates: readonly string[];
  readonly files: readonly PrimitiveContractFile[];
};

export type PrimitiveContractFinding = {
  readonly field: "name" | "namespace" | "version" | "files";
  readonly message: string;
};

export const createPrimitiveContract = (
  contract: PrimitiveContract,
): PrimitiveContract => contract;

type PrimitiveContractCheckContext = {
  readonly contract: PrimitiveContract;
  readonly fileKinds: ReadonlySet<PrimitiveFileKind>;
  readonly hasConfectRuntime: boolean;
};

type PrimitiveContractCheck = (
  context: PrimitiveContractCheckContext,
) => PrimitiveContractFinding | undefined;

const requirePrimitiveName: PrimitiveContractCheck = ({ contract }) =>
  contract.name.trim().length === 0
    ? { field: "name", message: "Primitive name is required." }
    : undefined;

const requirePrimitiveNamespace: PrimitiveContractCheck = ({ contract }) =>
  contract.namespace.trim().length === 0
    ? {
        field: "namespace",
        message: "Primitive namespace is required.",
      }
    : undefined;

const requirePrimitiveVersion: PrimitiveContractCheck = ({ contract }) =>
  contract.version < 1
    ? {
        field: "version",
        message: "Primitive version must be at least 1.",
      }
    : undefined;

const requireDomainOrViewModel: PrimitiveContractCheck = ({ fileKinds }) =>
  !fileKinds.has("domain") && !fileKinds.has("frontend-state")
    ? {
        field: "files",
        message: "Each primitive needs a pure domain or view-model file.",
      }
    : undefined;

const requireConfectFiles: PrimitiveContractCheck = ({
  fileKinds,
  hasConfectRuntime,
}) =>
  hasConfectRuntime && (!fileKinds.has("spec") || !fileKinds.has("impl"))
    ? {
        field: "files",
        message: "Confect primitives need both spec and impl files.",
      }
    : undefined;

const requireManifestMetadata: PrimitiveContractCheck = ({
  contract,
  fileKinds,
}) =>
  contract.surfaces.length > 0 && !fileKinds.has("manifest")
    ? {
        field: "files",
        message: "Exposed primitives need manifest metadata.",
      }
    : undefined;

const requireWorkflowHandler: PrimitiveContractCheck = ({
  contract,
  fileKinds,
}) =>
  contract.hasInternalWorkflowStep && !fileKinds.has("workflow-handler")
    ? {
        field: "files",
        message:
          "Workflow-step primitives need a workflow handler or dispatch file.",
      }
    : undefined;

const requireFrontendState: PrimitiveContractCheck = ({
  contract,
  fileKinds,
}) =>
  contract.uiStates.length > 0 && !fileKinds.has("frontend-state")
    ? {
        field: "files",
        message: "UI-visible primitives need a frontend state file.",
      }
    : undefined;

const primitiveContractChecks: readonly PrimitiveContractCheck[] = [
  requirePrimitiveName,
  requirePrimitiveNamespace,
  requirePrimitiveVersion,
  requireDomainOrViewModel,
  requireConfectFiles,
  requireManifestMetadata,
  requireWorkflowHandler,
  requireFrontendState,
];

export const checkPrimitiveContract = (
  contract: PrimitiveContract,
): readonly PrimitiveContractFinding[] => {
  const fileKinds = new Set(contract.files.map((file) => file.kind));
  const hasConfectRuntime = contract.runtimes.some((runtime) =>
    runtime.startsWith("confect-"),
  );

  return primitiveContractChecks.flatMap((check) => {
    const finding = check({ contract, fileKinds, hasConfectRuntime });
    return finding === undefined ? [] : [finding];
  });
};
