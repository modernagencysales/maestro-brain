export const exactLaneGreenSha = (
  value: unknown,
  length: 40 | 64,
  label: string,
): string => {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
};
