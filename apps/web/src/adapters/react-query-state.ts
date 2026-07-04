import {
  classifyUnknownFailure,
  readyOrEmpty,
  type NormalizeOptions,
  type TemplateDataState,
  type TemplateDefectState,
  type TemplateParseFailureState,
  type TemplateTransportFailureState,
} from "./confect-state";

export type ReactQueryLikeResult<T> =
  | {
      readonly status: "pending";
      readonly data?: undefined;
      readonly error?: null;
      readonly fetchStatus?: string;
    }
  | {
      readonly status: "success";
      readonly data: T;
      readonly error?: null;
      readonly fetchStatus?: string;
    }
  | {
      readonly status: "error";
      readonly data?: T;
      readonly error: unknown;
      readonly fetchStatus?: string;
    };

export function normalizeReactQueryResult<T>(
  result: ReactQueryLikeResult<T>,
  options: NormalizeOptions<T> = {},
): TemplateDataState<T, unknown> {
  if (result.status === "pending") {
    return { status: "loading" };
  }

  if (result.status === "error") {
    return classifyReactQueryFailure(result.error);
  }

  return readyOrEmpty(result.data, options);
}

function classifyReactQueryFailure(
  error: unknown,
):
  | TemplateParseFailureState
  | TemplateTransportFailureState
  | TemplateDefectState {
  if (error instanceof SyntaxError) {
    return {
      status: "parse_failure",
      error,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      status: "transport_failure",
      error,
      message: error.message,
    };
  }

  return classifyUnknownFailure(error);
}
