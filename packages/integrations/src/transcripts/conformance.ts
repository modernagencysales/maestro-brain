import * as Schema from "effect/Schema";

import {
  CanonicalCallTranscript,
  type CanonicalCallTranscript as CanonicalCallTranscriptType,
} from "./canonical";

type AdapterInput = { readonly connectionKey: string };

export const transcriptAdapterConformance = <Input extends AdapterInput>(
  name: string,
  normalize: (input: Input) => CanonicalCallTranscriptType,
  fixture: {
    readonly valid: Input;
    readonly invalid: Input;
    readonly privateMarker: string;
  },
): void => {
  const firstRaw = normalize(fixture.valid);
  const first = Schema.decodeUnknownSync(CanonicalCallTranscript)(firstRaw);
  const repeated = normalize(fixture.valid);
  const reconnected = normalize({
    ...fixture.valid,
    connectionKey: "connection-two",
  });
  requireConformance(first.providerKey === name, name, "provider key");
  requireConformance(
    JSON.stringify(firstRaw) === JSON.stringify(repeated) &&
      first.externalRevisionId === reconnected.externalRevisionId,
    name,
    "deterministic output",
  );
  requireConformance(
    first.segments.every(
      (segment, ordinal) =>
        segment.ordinal === ordinal && segment.text.trim().length > 0,
    ),
    name,
    "ordered non-empty segments",
  );
  requireConformance(
    !/(api[_-]?key|access[_-]?token|authorization|client[_-]?secret)/i.test(
      JSON.stringify(first),
    ),
    name,
    "credential-free output",
  );

  let failure: unknown;
  try {
    normalize(fixture.invalid);
  } catch (error) {
    failure = error;
  }
  requireConformance(failure !== undefined, name, "invalid payload rejection");
  requireConformance(
    !String(failure).includes(fixture.privateMarker) &&
      !JSON.stringify(failure).includes(fixture.privateMarker),
    name,
    "redacted failure",
  );
};

const requireConformance = (
  condition: boolean,
  name: string,
  requirement: string,
): void => {
  if (!condition) throw new Error(`${name} failed ${requirement} conformance`);
};
