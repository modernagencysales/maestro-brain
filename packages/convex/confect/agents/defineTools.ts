import {
  defineModelToolsFromRegistry,
  type ModelTool,
  type ModelToolDefinition,
  type ToolCandidate,
} from "./modelTool";
import { sourceGroundedBriefToolDefinition } from "./sourceGroundedBriefTool";

export {
  type ModelTool,
  type ModelToolExecution,
  type PreparedModelToolInvocation,
  type PrepareModelToolResult,
  type ToolCandidate,
  type ToolOperationType,
  type ToolPresentation,
  type ToolVisibility,
} from "./modelTool";
export { sourceGroundedBriefTool } from "./sourceGroundedBriefTool";

const modelToolRegistry = [
  sourceGroundedBriefToolDefinition,
] as const satisfies readonly ModelToolDefinition[];

export const defineModelTools = (
  candidates: readonly ToolCandidate[],
): readonly ModelTool[] =>
  defineModelToolsFromRegistry(candidates, modelToolRegistry);

export const defaultToolCandidates = modelToolRegistry.map(
  (definition) => definition.candidate,
);
