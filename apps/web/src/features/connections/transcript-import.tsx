import { Button, Card, Heading, Input, Stack, Text } from "@saas-ui/react";
import { useState, type FormEvent } from "react";

export const TRANSCRIPT_IMPORT_ACCEPT =
  ".json,.vtt,.srt,.txt,.md,text/plain,text/vtt,application/json,text/markdown";

export type TranscriptImportRequest = {
  readonly format: "json" | "vtt" | "srt" | "txt" | "markdown";
  readonly content: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly participantEmails: readonly string[];
  readonly targetBrainKey?: string;
};

export type TranscriptImportState =
  | { readonly status: "idle" | "reading" | "importing" }
  | { readonly status: "success" | "typed_failure" | "transport_failure" };

export function TranscriptImport({
  onImport,
  role,
  state,
  targets,
}: {
  readonly onImport: (input: TranscriptImportRequest) => void | Promise<void>;
  readonly role: "viewer" | "editor" | "admin" | "owner";
  readonly state: TranscriptImportState;
  readonly targets: readonly {
    readonly brainKey: string;
    readonly name: string;
  }[];
}) {
  const [validation, setValidation] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const canImport = role !== "viewer";
  const busy =
    reading || state.status === "reading" || state.status === "importing";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    setValidation(null);
    setReading(true);
    try {
      const request = await transcriptImportFromFormData(new FormData(form));
      setReading(false);
      await onImport(request);
      form.reset();
    } catch (error) {
      setReading(false);
      setValidation(
        error instanceof Error
          ? error.message
          : "Transcript import is invalid.",
      );
    }
  };

  return (
    <Card.Root
      as="form"
      aria-label="Import transcript"
      onSubmit={(event) => void submit(event)}
    >
      <Card.Header>
        <Heading size="md">Import a transcript</Heading>
        <Text color="gray.600" fontSize="sm">
          Upload a transcript from any provider that is not connected yet.
        </Text>
      </Card.Header>
      <Card.Body>
        <fieldset disabled={!canImport || busy}>
          <Stack gap="3">
            <label htmlFor="transcript-file">Transcript file</label>
            <input
              accept={TRANSCRIPT_IMPORT_ACCEPT}
              id="transcript-file"
              name="file"
              required
              type="file"
            />
            <label htmlFor="transcript-title">Call title</label>
            <Input id="transcript-title" name="title" required />
            <label htmlFor="transcript-occurred-at">Call date and time</label>
            <Input
              id="transcript-occurred-at"
              name="occurredAt"
              required
              type="datetime-local"
            />
            <label htmlFor="transcript-participants">Participant emails</label>
            <Input
              id="transcript-participants"
              name="participantEmails"
              placeholder="buyer@example.com, seller@example.com"
            />
            <label htmlFor="transcript-target">Optional target Brain</label>
            <select
              defaultValue=""
              id="transcript-target"
              name="targetBrainKey"
            >
              <option value="">Route automatically</option>
              {targets.map((target) => (
                <option key={target.brainKey} value={target.brainKey}>
                  {target.name}
                </option>
              ))}
            </select>
            <Button type="submit">
              {busy ? "Importing…" : "Import transcript"}
            </Button>
            {!canImport ? (
              <Text>Editor access is required to import transcripts.</Text>
            ) : null}
            <ImportStatus
              state={reading ? { status: "reading" } : state}
              validation={validation}
            />
          </Stack>
        </fieldset>
      </Card.Body>
    </Card.Root>
  );
}

const ImportStatus = ({
  state,
  validation,
}: {
  readonly state: TranscriptImportState;
  readonly validation: string | null;
}) => {
  if (validation) return <Text role="alert">{validation}</Text>;
  if (state.status === "reading")
    return <Text role="status">Reading transcript…</Text>;
  if (state.status === "importing")
    return <Text role="status">Importing transcript…</Text>;
  if (state.status === "success")
    return (
      <Text role="status">
        Transcript imported. Brain processing has started.
      </Text>
    );
  if (state.status === "typed_failure")
    return (
      <Text role="alert">
        Transcript was rejected. Check the file and target Brain.
      </Text>
    );
  if (state.status === "transport_failure")
    return <Text role="alert">Import connection failed. Try again.</Text>;
  return null;
};

export const transcriptImportFromFormData = async (
  data: FormData,
): Promise<TranscriptImportRequest> => {
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new Error("Select a transcript file.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const format = extension === "md" ? "markdown" : extension;
  if (!format || !["json", "vtt", "srt", "txt", "markdown"].includes(format))
    throw new Error("Use a JSON, VTT, SRT, TXT, or Markdown file.");
  const title = String(data.get("title") ?? "").trim();
  const occurredAt = String(data.get("occurredAt") ?? "").trim();
  if (!title) throw new Error("Enter a call title.");
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt)))
    throw new Error("Enter the call date and time.");
  const participantEmails = String(data.get("participantEmails") ?? "")
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (
    participantEmails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Error("Enter valid participant emails.");
  const targetBrainKey = String(data.get("targetBrainKey") ?? "").trim();
  return {
    format: format as TranscriptImportRequest["format"],
    content: await file.text(),
    title,
    occurredAt: new Date(occurredAt).toISOString(),
    participantEmails,
    ...(targetBrainKey ? { targetBrainKey } : {}),
  };
};
