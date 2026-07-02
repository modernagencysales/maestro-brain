import {
  makePublicError,
  redactUnknownError,
  type TemplatePublicError,
} from "../shared/errors";
import { HeadlessAuthError } from "./auth";

export type HeadlessErrorEnvelope = {
  readonly ok: false;
  readonly requestId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, string | number | boolean>>;
  };
};

const publicErrorFromHeadlessAuth = (
  error: HeadlessAuthError,
): TemplatePublicError =>
  makePublicError(
    error.code === "API_KEY_FORBIDDEN"
      ? "NO_WORKSPACE_ACCESS"
      : "UNAUTHENTICATED",
    error.message,
  );

export const createHeadlessErrorEnvelope = (
  error: unknown,
  requestId: string,
): HeadlessErrorEnvelope => {
  const publicError =
    error instanceof HeadlessAuthError
      ? publicErrorFromHeadlessAuth(error)
      : redactUnknownError(error);
  const envelopeError = publicError.details
    ? {
        code: publicError.code,
        message: publicError.message,
        details: publicError.details,
      }
    : {
        code: publicError.code,
        message: publicError.message,
      };

  return {
    ok: false,
    requestId,
    error: envelopeError,
  };
};
