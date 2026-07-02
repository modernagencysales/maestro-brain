import {
  QueryResult,
  useMutation as useConfectMutation,
  useQuery as useConfectQuery,
  type ReactMutation,
} from "@confect/react";
import type { Ref } from "@confect/core";
import * as Either from "effect/Either";

export type TemplateReadyMode = "read" | "edit";

export type TemplateSkippedState = {
  readonly status: "skipped";
};

export type TemplateLoadingState = {
  readonly status: "loading";
};

export type TemplateEmptyState<T> = {
  readonly status: "empty";
  readonly data: T;
};

export type TemplateReadyState<T> = {
  readonly status: "ready";
  readonly mode: TemplateReadyMode;
  readonly data: T;
};

export type TemplateMutationSuccessState<T> = TemplateReadyState<T> & {
  readonly mutation: "success";
};

export type TemplateTypedFailureState<E> = {
  readonly status: "typed_failure";
  readonly error: E;
};

export type TemplateParseFailureState = {
  readonly status: "parse_failure";
  readonly error: unknown;
  readonly message: string;
};

export type TemplateTransportFailureState = {
  readonly status: "transport_failure";
  readonly error: unknown;
  readonly message: string;
};

export type TemplateDefectState = {
  readonly status: "defect";
  readonly error: unknown;
  readonly message: string;
};

export type TemplateDataState<T, E = never> =
  | TemplateSkippedState
  | TemplateLoadingState
  | TemplateEmptyState<T>
  | TemplateReadyState<T>
  | TemplateTypedFailureState<E>
  | TemplateParseFailureState
  | TemplateTransportFailureState
  | TemplateDefectState;

export type TemplateMutationState<T, E = never> =
  | TemplateLoadingState
  | TemplateMutationSuccessState<T>
  | TemplateTypedFailureState<E>
  | TemplateParseFailureState
  | TemplateTransportFailureState
  | TemplateDefectState;

export type NormalizeOptions<T> = {
  readonly mode?: TemplateReadyMode;
  readonly isEmpty?: (value: T) => boolean;
};

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

export function normalizeConfectQuery<T, E>(
  result: QueryResult.QueryResult<T, E>,
  options: NormalizeOptions<T> = {},
): TemplateDataState<T, E> {
  if (QueryResult.isLoading(result)) {
    return result.skipped ? { status: "skipped" } : { status: "loading" };
  }

  if (QueryResult.isFailure(result)) {
    return { status: "typed_failure", error: result.error };
  }

  return readyOrEmpty(result.value, options);
}

export function normalizeReactQueryResult<T>(
  result: ReactQueryLikeResult<T>,
  options: NormalizeOptions<T> = {},
): TemplateDataState<T, never> {
  if (result.status === "pending") {
    return { status: "loading" };
  }

  if (result.status === "error") {
    return classifyReactQueryFailure(result.error);
  }

  return readyOrEmpty(result.data, options);
}

export function normalizeMutationPending(): TemplateMutationState<
  never,
  never
> {
  return { status: "loading" };
}

export function normalizeMutationSuccess<T>(
  data: T,
  options: Pick<NormalizeOptions<T>, "mode"> = {},
): TemplateMutationSuccessState<T> {
  return {
    status: "ready",
    mode: options.mode ?? "read",
    data,
    mutation: "success",
  };
}

export function classifyConfectMutationResult<T, E>(
  result: Either.Either<T, E> | T,
  options: Pick<NormalizeOptions<T>, "mode"> = {},
): TemplateMutationState<T, E> {
  if (Either.isEither(result)) {
    return Either.isLeft(result)
      ? { status: "typed_failure", error: result.left }
      : normalizeMutationSuccess(result.right, options);
  }

  return normalizeMutationSuccess(result, options);
}

export function normalizeMutationError(
  error: unknown,
):
  | TemplateParseFailureState
  | TemplateTransportFailureState
  | TemplateDefectState {
  return classifyUnknownFailure(error);
}

export function useTemplateQuery<Query extends Ref.AnyPublicQuery>(
  ref: Query,
  args: Ref.Args<Query> | "skip",
  options?: NormalizeOptions<Ref.Returns<Query>>,
): TemplateDataState<Ref.Returns<Query>, Ref.Error<Query>> {
  return normalizeConfectQuery(useConfectQuery(ref, args), options);
}

export function useTemplateMutation<Mutation extends Ref.AnyPublicMutation>(
  ref: Mutation,
): ReactMutation<Mutation> {
  return useConfectMutation(ref);
}

function readyOrEmpty<T>(
  data: T,
  options: NormalizeOptions<T>,
): TemplateEmptyState<T> | TemplateReadyState<T> {
  if ((options.isEmpty ?? defaultIsEmpty)(data)) {
    return { status: "empty", data };
  }

  return {
    status: "ready",
    mode: options.mode ?? "read",
    data,
  };
}

function defaultIsEmpty(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function classifyUnknownFailure(
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
      status: error instanceof TypeError ? "transport_failure" : "defect",
      error,
      message: error.message,
    };
  }

  return {
    status: "defect",
    error,
    message: "Unexpected client defect.",
  };
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
