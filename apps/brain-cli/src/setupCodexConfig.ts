const MANAGED_HEADER = /^[ \t]*\[mcp_servers\.maestro_brain\][ \t]*(?:#.*)?$/mu;
const TABLE_HEADER = /^[ \t]*\[{1,2}[^\r\n]+?\]{1,2}[ \t]*(?:#.*)?$/mu;

export const mergeCodexMcpBlock = (
  current: string,
  expectedBlock: string,
): { readonly content: string; readonly changed: boolean } => {
  const managedHeader = MANAGED_HEADER.exec(current);
  if (managedHeader === null)
    return {
      content: `${current.trimEnd()}\n\n${expectedBlock}`,
      changed: true,
    };
  const start = managedHeader.index;
  const afterHeader = start + managedHeader[0].length;
  const nextHeader = TABLE_HEADER.exec(current.slice(afterHeader));
  const end =
    nextHeader === null ? current.length : afterHeader + nextHeader.index;
  const expected = expectedBlock.trim();
  if (current.slice(start, end).trim() === expected)
    return { content: current, changed: false };
  const suffix =
    end === current.length ? "\n" : `\n\n${current.slice(end).trimStart()}`;
  return {
    content: `${current.slice(0, start)}${expected}${suffix}`,
    changed: true,
  };
};
