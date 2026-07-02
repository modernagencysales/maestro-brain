export const packageName = "@maestro-template/convex";

import type refs from "../confect/_generated/refs";

export type TemplateConfectRefs = typeof refs;

export { default as templateConfectRefs } from "../confect/_generated/refs";

export {
  handleTemplateHttpRequest,
  securityHeaders,
  templateHttpRoutes,
  type TemplateHttpRoute,
} from "../confect/http";
