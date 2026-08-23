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

export const ingestSlackEvent = async (db: IngressDb, input: IngressInput) => {
  const binding = await admitSlackSignedEvent(input);
  return await ingestVerifiedSlackEvent(db, input, binding);
};

export const ingestVerifiedSlackEvent = async (
  db: IngressDb,
  input: Pick<
    IngressInput,
    "payload" | "transportDeliveryId" | "routing" | "receivedAt" | "channelKey"
  > & { readonly providerEventId: string },
  binding: VerifiedSlackEnvelope,
) => {
  if (await db.findReceipt(input.transportDeliveryId))
    return { outcome: "duplicate_delivery" as const };
  if (db.findReplay && (await db.findReplay(input.providerEventId)))
    return { outcome: "duplicate_replay" as const };
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
          existingArtifact: source as {
            sourceKey: string;
            latestProviderOrder: string;
            lifecycle: { generation: number };
            createdAt: number;
          },
        }
      : {}),
  });
  await db.insert("providerEventReceipts", rows.receipt);
  if (rows.artifact && rows.revision && rows.processingJob) {
    if (source)
      await db.patchArtifact(source as { _id?: string }, rows.artifact);
    else await db.insert("sourceArtifacts", rows.artifact);
    await db.insert("sourceRevisions", rows.revision);
    await db.insert("sourceProcessingJobs", rows.processingJob);
  }
  return {
    outcome: (rows.receipt as { outcome: string }).outcome,
    ...(rows.revision === null || rows.revision === undefined
      ? {}
      : {
          sourceKey: (rows.revision as { sourceKey: string }).sourceKey,
          sourceRevisionKey: (rows.revision as { sourceRevisionKey: string })
            .sourceRevisionKey,
        }),
  };
};
