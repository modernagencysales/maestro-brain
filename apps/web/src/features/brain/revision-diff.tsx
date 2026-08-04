export type BrainRevisionDiffInput = {
  readonly beforeRevisionKey: string;
  readonly afterRevisionKey: string;
  readonly before: string;
  readonly after: string;
};

export type BrainRevisionDiffLine = {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
};

export const buildBrainRevisionDiff = ({
  before,
  after,
}: BrainRevisionDiffInput): readonly BrainRevisionDiffLine[] => {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: BrainRevisionDiffLine[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const previous = beforeLines[index];
    const next = afterLines[index];
    if (previous === next && previous !== undefined) {
      lines.push({ kind: "same", text: previous });
    } else {
      if (previous !== undefined)
        lines.push({ kind: "removed", text: previous });
      if (next !== undefined) lines.push({ kind: "added", text: next });
    }
  }
  return lines;
};

export function RevisionDiff({
  diff,
}: {
  readonly diff: BrainRevisionDiffInput;
}) {
  return (
    <section aria-label="Revision diff">
      <div>
        <span>From {diff.beforeRevisionKey}</span>{" "}
        <span>To {diff.afterRevisionKey}</span>
      </div>
      <pre>
        {buildBrainRevisionDiff(diff).map((line, index) => (
          <span
            key={`${line.kind}-${index}`}
            style={{
              display: "block",
              color:
                line.kind === "removed"
                  ? "red"
                  : line.kind === "added"
                    ? "green"
                    : undefined,
            }}
          >
            {line.kind === "removed"
              ? "- "
              : line.kind === "added"
                ? "+ "
                : "  "}
            {line.text}
          </span>
        ))}
      </pre>
    </section>
  );
}
