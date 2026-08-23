import { ValidationFailed } from "../errors";

export const validatePilotText = (
  field: "title" | "markdown" | "query",
  value: string,
): ValidationFailed | null =>
  value.trim().length === 0
    ? new ValidationFailed({ field, message: `${field} is required.` })
    : null;
