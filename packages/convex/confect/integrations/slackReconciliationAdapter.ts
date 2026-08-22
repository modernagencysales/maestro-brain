import { sha256Hex } from "../shared/sha256";
import type { ProviderObservation } from "./providerReconciliation";

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
});
