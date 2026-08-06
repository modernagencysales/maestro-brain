import type { Ref } from "@confect/core";
import type { TemplateConfectRefs } from "@maestro-template/convex/refs";
import { Badge, Box, Card, Heading, Stack, Text } from "@saas-ui/react";

type GetBrainExportRef =
  TemplateConfectRefs["public"]["ops"]["dataLifecycle"]["getBrainExport"];

export type BrainExportJob = Ref.Returns<GetBrainExportRef>;
export type BrainExportViewState =
  | { readonly status: "empty" | "loading" }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "ready"; readonly job: BrainExportJob };

export function ExportHistory({
  state,
}: {
  readonly state: BrainExportViewState;
}) {
  return (
    <Stack aria-label="Brain export history" as="section" gap="3">
      <Heading size="sm">Export history</Heading>
      {state.status === "empty" ? <Text>No exports requested.</Text> : null}
      {state.status === "loading" ? (
        <Text role="status">Loading export…</Text>
      ) : null}
      {state.status === "unavailable" ? (
        <Text color="red.600" role="alert">
          {state.message}
        </Text>
      ) : null}
      {state.status === "ready" ? <ExportRow job={state.job} /> : null}
    </Stack>
  );
}

function ExportRow({ job }: { readonly job: BrainExportJob }) {
  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="2">
          <Box>
            <Text fontWeight="semibold">{job.jobId}</Text>
            <Badge>{job.state}</Badge>
          </Box>
          {job.manifestHash ? (
            <Text fontSize="sm">Manifest hash: {job.manifestHash}</Text>
          ) : null}
          {job.artifactHash ? (
            <Text fontSize="sm">Artifact hash: {job.artifactHash}</Text>
          ) : null}
          {job.expiresAt ? (
            <Text fontSize="sm">
              Expires: {new Date(job.expiresAt).toLocaleString()}
            </Text>
          ) : null}
          {job.downloadUrl ? (
            <a download href={job.downloadUrl}>
              Download export
            </a>
          ) : null}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
