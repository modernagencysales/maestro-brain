export type CallRouteMapping = {
  readonly organizationKey: string;
  readonly kind: "recurring_meeting" | "email" | "domain" | "stakeholder";
  readonly value: string;
  readonly brainKey: string;
};

type CallMatchInput = {
  readonly organizationKey: string;
  readonly allowedBrainKeys: readonly string[];
  readonly explicitBrainKey?: string;
  readonly recurringMeetingId?: string;
  readonly agencyDomains?: readonly string[];
  readonly participants: readonly {
    readonly email: string | null;
    readonly domain: string | null;
  }[];
  readonly mappings: readonly CallRouteMapping[];
};

export type CallMatch =
  | {
      readonly kind: "exact";
      readonly brainKey: string;
      readonly reason:
        | "explicit"
        | "recurring_meeting"
        | "participant_email"
        | "participant_domain"
        | "known_stakeholder";
    }
  | { readonly kind: "mixed_client"; readonly brainKeys: readonly string[] }
  | { readonly kind: "agency_internal" }
  | { readonly kind: "no_match" };

const normalized = (value: string) => value.trim().toLowerCase();

export const matchCall = (input: CallMatchInput): CallMatch => {
  const allowed = new Set(input.allowedBrainKeys);
  if (input.explicitBrainKey && allowed.has(input.explicitBrainKey))
    return {
      kind: "exact",
      brainKey: input.explicitBrainKey,
      reason: "explicit",
    };

  const mappings = input.mappings.filter(
    ({ organizationKey, brainKey }) =>
      organizationKey === input.organizationKey && allowed.has(brainKey),
  );
  const recurrence = input.recurringMeetingId
    ? mappings.filter(
        ({ kind, value }) =>
          kind === "recurring_meeting" &&
          normalized(value) === normalized(input.recurringMeetingId ?? ""),
      )
    : [];
  const recurrenceBrains = [
    ...new Set(recurrence.map(({ brainKey }) => brainKey)),
  ].sort();
  if (recurrenceBrains.length > 1)
    return { kind: "mixed_client", brainKeys: recurrenceBrains };
  if (recurrenceBrains[0])
    return {
      kind: "exact",
      brainKey: recurrenceBrains[0],
      reason: "recurring_meeting",
    };

  const agencyDomains = new Set((input.agencyDomains ?? []).map(normalized));
  if (
    input.participants.length > 0 &&
    input.participants.every(
      ({ domain }) => domain !== null && agencyDomains.has(normalized(domain)),
    )
  )
    return { kind: "agency_internal" };

  const emails = new Set(
    input.participants.flatMap(({ email }) =>
      email === null ? [] : [normalized(email)],
    ),
  );
  const domains = new Set(
    input.participants.flatMap(({ domain }) =>
      domain === null ? [] : [normalized(domain)],
    ),
  );
  const matches = mappings.filter(({ kind, value }) => {
    const candidate = normalized(value);
    return kind === "email" || kind === "stakeholder"
      ? emails.has(candidate)
      : kind === "domain"
        ? domains.has(candidate)
        : false;
  });
  const brainKeys = [
    ...new Set(matches.map(({ brainKey }) => brainKey)),
  ].sort();
  if (brainKeys.length > 1) return { kind: "mixed_client", brainKeys };
  const brainKey = brainKeys[0];
  if (!brainKey) return { kind: "no_match" };
  const reason = matches.some(
    (match) => match.brainKey === brainKey && match.kind === "email",
  )
    ? "participant_email"
    : matches.some(
          (match) => match.brainKey === brainKey && match.kind === "domain",
        )
      ? "participant_domain"
      : "known_stakeholder";
  return { kind: "exact", brainKey, reason };
};
