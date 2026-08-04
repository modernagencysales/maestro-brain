export const packageName = "@maestro-template/convex";

export { api } from "../convex/_generated/api";

export { templateConfectRefs, type TemplateConfectRefs } from "./refs";

export {
  handleTemplateHttpRequest,
  securityHeaders,
  templateHttpRoutes,
  type HeadlessHttpCtx,
  type TemplateHttpRoute,
} from "../confect/http";

export {
  buildRetentionJobPlan,
  buildWorkspaceDataLifecyclePlan,
  buildWorkspaceDsarPlan,
  currentLifecycleResourceIds,
  type DsarDeletePlanEntry,
  type DsarExportManifestEntry,
  type DsarRequestKind,
  type DsarRequestStatus,
  type LegalHold,
  type LifecycleResourceId,
  type LifecycleResourcePlan,
  type RetentionJobPlan,
  type RetentionRule,
  type WorkspaceDataLifecyclePlan,
  type WorkspaceDsarPlan,
} from "../confect/ops/dataLifecycle";
