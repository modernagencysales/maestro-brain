export type SnapshotProvenance = {
  readonly asOf: string;
  readonly source: string;
};

export type ValidSnapshotProvenance = SnapshotProvenance & {
  readonly ok: true;
};

export type SnapshotProvenanceResult =
  ValidSnapshotProvenance | { readonly ok: false; readonly message: string };

const isIsoDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

export const validateSnapshotProvenance = (
  provenance: SnapshotProvenance,
): SnapshotProvenanceResult => {
  if (!isIsoDate(provenance.asOf))
    return {
      ok: false,
      message: "snapshot --as-of must be a real date in YYYY-MM-DD format.",
    };

  const source = provenance.source.trim();
  return source && source.length <= 120 && !/[\r\n]/.test(source)
    ? { ok: true, asOf: provenance.asOf, source }
    : {
        ok: false,
        message: "snapshot --source must contain 1 to 120 characters.",
      };
};

export const markdownWithSnapshotProvenance = (
  markdown: string,
  provenance: SnapshotProvenance,
): string =>
  [
    `> Snapshot source: ${provenance.source}`,
    `> Snapshot date: ${provenance.asOf}`,
    "> This is reviewed point-in-time evidence, not a live synchronization.",
    "",
    markdown,
  ].join("\n");
