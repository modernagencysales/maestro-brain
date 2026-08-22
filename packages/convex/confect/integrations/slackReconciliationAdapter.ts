import * as Schema from "effect/Schema";

import { sha256Hex } from "../shared/sha256";
import {
  SourceLedgerCaptureInput,
  VerifiedSlackChannelBinding,
  buildSourceLedgerRows,
} from "../sources/sourceSchemas";
import type { ProviderObservation } from "./providerReconciliation";

export const PreparedSlackReconciliationWrite = Schema.Struct({
  binding: VerifiedSlackChannelBinding,
  input: SourceLedgerCaptureInput,
});
export type PreparedSlackReconciliationWrite =
  typeof PreparedSlackReconciliationWrite.Type;

export const PreparedSlackReconciliationPage = Schema.Struct({
  connectorScopeKey: Schema.String,
  cursorBefore: Schema.NullOr(Schema.String),
  cursorAfter: Schema.NullOr(Schema.String),
  terminal: Schema.Boolean,
  chunks: Schema.Array(
    Schema.Array(PreparedSlackReconciliationWrite).pipe(Schema.maxItems(100)),
  ).pipe(Schema.minItems(1), Schema.maxItems(64)),
});
export type PreparedSlackReconciliationPage =
  typeof PreparedSlackReconciliationPage.Type;

export type SlackReconciliationObservationInput = {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly channelKey: string;
  readonly sourceKey: string;
  readonly sourceRevisionKey: string;
  readonly providerObjectKey: string;
  readonly ledgerSequence: number;
  readonly observationDigest: string;
  readonly tombstone?: boolean;
};

export const slackReconciliationObservation = (
  input: SlackReconciliationObservationInput,
): ProviderObservation => ({
  organizationKey: input.organizationKey,
  connectionKey: input.connectionKey,
  connectionGeneration: input.connectionGeneration,
  membershipKey: `cmem_${sha256Hex(
    JSON.stringify({
      kind: "slack",
      organizationKey: input.organizationKey,
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      channelKey: input.channelKey,
      providerObjectKey: input.providerObjectKey,
    }),
  )}`,
  providerObjectKey: input.providerObjectKey,
  originKind: "slack",
  originKey: input.sourceKey,
  originRevisionKey: input.sourceRevisionKey,
  ledgerSequence: input.ledgerSequence,
  observationDigest: input.observationDigest,
  ...(input.tombstone === true
    ? {
        obligationCause: "removal" as const,
        initialObligationState: "removal_pending" as const,
      }
    : {}),
});

export const prepareSlackReconciliationWrite = (input: {
  readonly binding: typeof VerifiedSlackChannelBinding.Type;
  readonly input: typeof SourceLedgerCaptureInput.Type;
}): PreparedSlackReconciliationWrite => {
  const prepared = Schema.decodeUnknownSync(PreparedSlackReconciliationWrite)(
    input,
  );
  if (
    prepared.input.envelope.transport !== "reconciliation" ||
    prepared.input.envelope.channelKey.trim().length === 0
  )
    throw new Error(
      "Slack reconciliation requires a canonical reconciliation envelope.",
    );
  return prepared;
};

export const buildSlackReconciliationRows = (input: {
  readonly write: PreparedSlackReconciliationWrite;
  readonly existingObservationKey?: string | undefined;
  readonly existingArtifact?:
    | {
        readonly sourceKey: string;
        readonly latestProviderOrder: string;
        readonly lifecycle: { readonly generation: number };
        readonly createdAt: number;
      }
    | undefined;
}) => {
  const prepared = prepareSlackReconciliationWrite(input.write);
  return buildSourceLedgerRows(prepared.input, {
    verifiedBinding: prepared.binding,
    ...(input.existingObservationKey === undefined
      ? {}
      : { existingObservationKey: input.existingObservationKey }),
    ...(input.existingArtifact === undefined
      ? {}
      : { existingArtifact: input.existingArtifact }),
  });
};
