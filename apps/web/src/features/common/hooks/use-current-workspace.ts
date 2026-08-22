"use client";

import type { TagDTO, WorkspaceDTO } from "@workspace/api/types";

import { useGoldenAdapter } from "../../golden/adapters";

import { useWorkspaceSlug } from "./use-workspace-slug";

export const useCurrentWorkspace = () => {
  useWorkspaceSlug();
  const { currentWorkspace } = useGoldenAdapter();
  const workspace: WorkspaceDTO & { tags: TagDTO[] } = {
    ...currentWorkspace,
    members: currentWorkspace.members.map((member) => ({ ...member })),
    subscription: { ...currentWorkspace.subscription },
    tags: currentWorkspace.tags.map((tag) => ({ ...tag })),
  };
  return [workspace] as const;
};
