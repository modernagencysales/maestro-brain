import { CanonicalCallTranscript } from "@maestro-template/integrations/transcripts/canonical";
import * as Schema from "effect/Schema";

import { sha256Hex } from "../shared/sha256";
import type { ProviderObservation } from "./providerReconciliation";

const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);

export const PreparedTranscriptReconciliationWrite = Schema.Struct({
  call: CanonicalCallTranscript,
  receivedAt: NonNegativeInteger,
});
export type PreparedTranscriptReconciliationWrite =
  typeof PreparedTranscriptReconciliationWrite.Type;

export const PreparedTranscriptReconciliationPage = Schema.Struct({
  connectorScopeKey: Schema.String,
  cursorBefore: Schema.NullOr(Schema.String),
  cursorAfter: Schema.NullOr(Schema.String),
  terminal: Schema.Boolean,
  chunks: Schema.Array(
    Schema.Array(PreparedTranscriptReconciliationWrite).pipe(
      Schema.maxItems(100),
    ),
  ).pipe(Schema.minItems(1), Schema.maxItems(64)),
});
export type PreparedTranscriptReconciliationPage =
  typeof PreparedTranscriptReconciliationPage.Type;

export type TranscriptReconciliationObservationInput = {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly providerKey: string;
  readonly unitKey: string;
  readonly unitRevisionKey: string;
  readonly externalCallId: string;
  readonly ledgerSequence: number;
  readonly observationDigest: string;
  readonly tombstone?: boolean;
};

export const transcriptReconciliationObservation = (
  input: TranscriptReconciliationObservationInput,
): ProviderObservation => ({
  organizationKey: input.organizationKey,
  connectionKey: input.connectionKey,
  connectionGeneration: input.connectionGeneration,
  membershipKey: `cmem_${sha256Hex(
    JSON.stringify({
      kind: "transcript",
      organizationKey: input.organizationKey,
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      providerKey: input.providerKey,
      externalCallId: input.externalCallId,
    }),
  )}`,
  providerObjectKey: input.externalCallId,
  originKind: "transcript",
  originKey: input.unitKey,
  originRevisionKey: input.unitRevisionKey,
  ledgerSequence: input.ledgerSequence,
  observationDigest: input.observationDigest,
  ...(input.tombstone === true
    ? {
        obligationCause: "removal" as const,
        initialObligationState: "removal_pending" as const,
      }
    : {}),
});

export const prepareTranscriptReconciliationWrite = (input: {
  readonly call: typeof CanonicalCallTranscript.Type;
  readonly receivedAt: number;
}): PreparedTranscriptReconciliationWrite =>
  Schema.decodeUnknownSync(PreparedTranscriptReconciliationWrite)(input);
