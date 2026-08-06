type NangoRecordAction =
  "added" | "updated" | "deleted" | "ADDED" | "UPDATED" | "DELETED";

export type NangoRecordFilter =
  NangoRecordAction | `${NangoRecordAction},${NangoRecordAction}`;

export type NangoListRecordsInput = {
  readonly connectionId: string;
  readonly providerConfigKey: string;
  readonly model: string;
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly filter?: NangoRecordFilter;
};

export type NangoRecordPage = {
  readonly records: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
};

export const boundedNangoRecordLimit = (limit = 100): number =>
  Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.trunc(limit))) : 100;
