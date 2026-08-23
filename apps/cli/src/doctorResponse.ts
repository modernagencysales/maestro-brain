type JsonResponse = {
  readonly value?: unknown;
  readonly failure?: string;
};

const recordValue = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;

const responseErrorTag = (response: JsonResponse): string | undefined => {
  const tag = recordValue(recordValue(response.value, "error"), "_tag");
  return typeof tag === "string" ? tag : undefined;
};

export const failedDoctorCheckDetail = (
  label: string,
  response: JsonResponse,
): string => {
  const reason = responseErrorTag(response) ?? response.failure;
  return `${label} check failed${reason ? `: ${reason}.` : "."}`;
};
