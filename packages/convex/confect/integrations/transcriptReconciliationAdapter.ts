import { sha256Hex } from "../shared/sha256";
import type { ProviderObservation } from "./providerReconciliation";

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
});
