import { admitSlackSignedEvent } from "./admission";
import {
  captureAdmittedSlackEvent,
  slackProviderObjectIdFor,
} from "./sourceCapture";
import type { VerifiedSlackEnvelope } from "../sources/sourceSchemas";

type IngressInput = Parameters<typeof admitSlackSignedEvent>[0] & {
  readonly payload: unknown;
  readonly transportDeliveryId: string;
  readonly routing: Parameters<typeof captureAdmittedSlackEvent>[2]["routing"];
  readonly receivedAt: number;
};

type VerifiedIngressInput = Pick<
  IngressInput,
  "payload" | "transportDeliveryId" | "routing" | "receivedAt" | "channelKey"
> & { readonly providerEventId: string };

type IngressDb = {
  readonly findReceipt: (
    transportDeliveryId: string,
  ) => Promise<unknown | null>;
  readonly findReplay?: (providerEventId: string) => Promise<unknown | null>;
  readonly findArtifact: (
    channelKey: string,
    providerObjectId: string,
  ) => Promise<unknown | null>;
  readonly insert: (table: string, row: unknown) => Promise<unknown>;
  readonly patchArtifact: (
    existing: { readonly _id?: string },
    row: unknown,
  ) => Promise<void>;
};

type ExistingSlackArtifact = Readonly<{
  _id?: string;
  sourceKey: string;
  latestProviderOrder: string;
  lifecycle: { generation: number };
  createdAt: number;
}>;

type SlackCaptureRows = ReturnType<typeof captureAdmittedSlackEvent>;

const duplicateOutcome = async (
  db: IngressDb,
  input: IngressInput | VerifiedIngressInput,
) => {
  if (await db.findReceipt(input.transportDeliveryId))
    return "duplicate_delivery" as const;
  if (db.findReplay && (await db.findReplay(input.providerEventId)))
    return "duplicate_replay" as const;
  return null;
};

const persistSlackCapture = async (
  db: IngressDb,
  source: unknown | null,
  rows: SlackCaptureRows,
) => {
  await db.insert("providerEventReceipts", rows.receipt);
  if (!(rows.artifact && rows.revision && rows.processingJob)) return;
  if (source)
    await db.patchArtifact(source as ExistingSlackArtifact, rows.artifact);
  else await db.insert("sourceArtifacts", rows.artifact);
  await db.insert("sourceRevisions", rows.revision);
  await db.insert("sourceProcessingJobs", rows.processingJob);
};

const slackIngestResult = (rows: SlackCaptureRows) => {
  const revision = rows.revision;
  return {
    outcome: (rows.receipt as { outcome: string }).outcome,
    ...(revision == null
      ? {}
      : {
          sourceKey: (revision as { sourceKey: string }).sourceKey,
          sourceRevisionKey: (revision as { sourceRevisionKey: string })
            .sourceRevisionKey,
        }),
  };
};

export const ingestSlackEvent = async (
  db: IngressDb,
  input: IngressInput | VerifiedIngressInput,
  verifiedBinding?: VerifiedSlackEnvelope,
) => {
  const binding =
    verifiedBinding === undefined
      ? await admitSlackSignedEvent(input as IngressInput)
      : verifiedBinding;
  const duplicate = await duplicateOutcome(db, input);
  if (duplicate !== null) return { outcome: duplicate };
  const envelope = {
    ...binding,
    transport: "live" as const,
    transportDeliveryId: input.transportDeliveryId,
    receivedAt: input.receivedAt,
  };
  const source = await db.findArtifact(
    input.channelKey,
    slackProviderObjectIdFor(input.payload),
  );
  const rows = captureAdmittedSlackEvent(binding, input.payload, {
    envelope,
    routing: input.routing,
    ...(source
      ? {
          existingArtifact: source as ExistingSlackArtifact,
        }
      : {}),
  });
  await persistSlackCapture(db, source, rows);
  return slackIngestResult(rows);
};
