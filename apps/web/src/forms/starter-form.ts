import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export type StarterFieldRule = {
  readonly label: string;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
  readonly patternMessage?: string;
};

export type StarterFormSchema<TValues extends Record<string, string>> = {
  readonly [Key in keyof TValues]: StarterFieldRule;
};

export type StarterFormErrors<TValues extends Record<string, string>> = Partial<
  Record<keyof TValues, string>
>;

export type StarterValidationResult<TValues extends Record<string, string>> = {
  readonly fieldErrors: StarterFormErrors<TValues>;
  readonly isValid: boolean;
};

export type StarterAutosavePlan =
  | {
      readonly status: "skip";
      readonly reason: "disabled" | "clean" | "invalid" | "submitting";
    }
  | {
      readonly status: "save";
      readonly dueInMs: number;
    };

export type StarterAutosaveStatus = "idle" | "waiting" | "saving" | "saved";

export const starterSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const trimStarterFormValues = <TValues extends Record<string, string>>(
  values: TValues,
): TValues =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim()]),
  ) as TValues;

export const validateStarterForm = <TValues extends Record<string, string>>(
  values: TValues,
  schema: StarterFormSchema<TValues>,
): StarterValidationResult<TValues> => {
  const fieldErrors: StarterFormErrors<TValues> = {};
  const trimmed = trimStarterFormValues(values);

  for (const key of Object.keys(schema) as Array<keyof TValues>) {
    const rule = schema[key];
    const value = trimmed[key] ?? "";

    if (rule.required === true && value.length === 0) {
      fieldErrors[key] = `${rule.label} is required.`;
      continue;
    }

    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      fieldErrors[key] =
        `${rule.label} must be ${rule.maxLength} characters or fewer.`;
      continue;
    }

    if (rule.pattern && value.length > 0 && !rule.pattern.test(value)) {
      fieldErrors[key] =
        rule.patternMessage ?? `${rule.label} has an invalid format.`;
    }
  }

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
  };
};

export const starterFieldValidator =
  <TValues extends Record<string, string>>(
    key: keyof TValues,
    schema: StarterFormSchema<TValues>,
  ) =>
  ({ value }: { readonly value: string }): string | undefined =>
    validateStarterForm(
      { [key]: value } as TValues,
      {
        [key]: schema[key],
      } as StarterFormSchema<TValues>,
    ).fieldErrors[key];

export const hasStarterFormChanges = <TValues extends Record<string, string>>(
  initialValues: TValues,
  currentValues: TValues,
): boolean => {
  const initial = trimStarterFormValues(initialValues);
  const current = trimStarterFormValues(currentValues);

  return (Object.keys(initial) as Array<keyof TValues>).some(
    (key) => initial[key] !== current[key],
  );
};

export const planStarterAutosave = ({
  canSubmit,
  debounceMs,
  enabled,
  isDirty,
  isSubmitting,
  lastChangedAt,
  now,
}: {
  readonly canSubmit: boolean;
  readonly debounceMs: number;
  readonly enabled: boolean;
  readonly isDirty: boolean;
  readonly isSubmitting: boolean;
  readonly lastChangedAt: number;
  readonly now: number;
}): StarterAutosavePlan => {
  if (!enabled) return { status: "skip", reason: "disabled" };
  if (!isDirty) return { status: "skip", reason: "clean" };
  if (!canSubmit) return { status: "skip", reason: "invalid" };
  if (isSubmitting) return { status: "skip", reason: "submitting" };

  const dueInMs = Math.max(0, lastChangedAt + debounceMs - now);
  return { status: "save", dueInMs };
};

export const starterBeforeUnloadMessage =
  "You have unsaved changes. Leave this page?";

export function useStarterDirtyRouteGuard({
  enabled,
  message = starterBeforeUnloadMessage,
}: {
  readonly enabled: boolean;
  readonly message?: string;
}) {
  useBlocker({
    disabled: !enabled,
    enableBeforeUnload: enabled,
    shouldBlockFn: () =>
      typeof window === "undefined" ? false : !window.confirm(message),
  });
}

export function useStarterAutosave<TValues extends Record<string, string>>({
  canSubmit,
  debounceMs = 800,
  enabled,
  isDirty,
  isSubmitting,
  onSave,
  values,
}: {
  readonly canSubmit: boolean;
  readonly debounceMs?: number;
  readonly enabled: boolean;
  readonly isDirty: boolean;
  readonly isSubmitting: boolean;
  readonly onSave: (values: TValues) => void | Promise<void>;
  readonly values: TValues;
}): StarterAutosaveStatus {
  const lastChangedAtRef = useRef(Date.now());
  const previousValuesRef = useRef(values);
  const savingRef = useRef(false);
  const [status, setStatus] = useState<StarterAutosaveStatus>("idle");

  useEffect(() => {
    if (previousValuesRef.current !== values) {
      previousValuesRef.current = values;
      lastChangedAtRef.current = Date.now();
      setStatus(isDirty ? "waiting" : "idle");
    }
  }, [isDirty, values]);

  useEffect(() => {
    const plan = planStarterAutosave({
      canSubmit,
      debounceMs,
      enabled,
      isDirty,
      isSubmitting: isSubmitting || savingRef.current,
      lastChangedAt: lastChangedAtRef.current,
      now: Date.now(),
    });

    if (plan.status === "skip") {
      if (plan.reason === "clean" || plan.reason === "disabled") {
        setStatus("idle");
      }
      return;
    }

    const timeout = window.setTimeout(() => {
      savingRef.current = true;
      setStatus("saving");
      void Promise.resolve(onSave(trimStarterFormValues(values))).finally(
        () => {
          savingRef.current = false;
          setStatus("saved");
        },
      );
    }, plan.dueInMs);

    return () => window.clearTimeout(timeout);
  }, [canSubmit, debounceMs, enabled, isDirty, isSubmitting, onSave, values]);

  return status;
}
