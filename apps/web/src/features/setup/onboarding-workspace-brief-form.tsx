import { useForm, useStore } from "@tanstack/react-form";
import { useTemplateToast } from "@maestro-template/ui";
import { useCallback, useMemo, useState } from "react";
import {
  hasStarterFormChanges,
  starterFieldValidator,
  starterSlugPattern,
  trimStarterFormValues,
  useStarterAutosave,
  useStarterDirtyRouteGuard,
  validateStarterForm,
  type StarterFormSchema,
} from "../../forms/starter-form";
import type { SetupMode } from "./setup-surface";

type OnboardingBriefValues = {
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  readonly activationGoal: string;
};

const onboardingBriefInitialValues: OnboardingBriefValues = {
  workspaceName: "Acme Client",
  workspaceSlug: "acme-client",
  activationGoal: "Run the first typed workflow and save a Trust Receipt.",
};

const onboardingBriefSchema: StarterFormSchema<OnboardingBriefValues> = {
  workspaceName: {
    label: "Workspace name",
    required: true,
    maxLength: 64,
  },
  workspaceSlug: {
    label: "Workspace slug",
    required: true,
    maxLength: 48,
    pattern: starterSlugPattern,
    patternMessage:
      "Workspace slug can use lowercase letters, numbers, and hyphens.",
  },
  activationGoal: {
    label: "Activation goal",
    required: true,
    maxLength: 160,
  },
};

export function OnboardingWorkspaceBriefForm({
  mode,
}: {
  readonly mode: SetupMode;
}) {
  const toast = useTemplateToast();
  const [savedDraft, setSavedDraft] = useState(onboardingBriefInitialValues);
  const saveDraft = useCallback((values: OnboardingBriefValues) => {
    setSavedDraft(trimStarterFormValues(values));
  }, []);
  const form = useForm({
    defaultValues: savedDraft,
    onSubmit: ({ value }) => {
      const trimmed = trimStarterFormValues(value);
      const validation = validateStarterForm(trimmed, onboardingBriefSchema);

      if (!validation.isValid) {
        const description =
          Object.values(validation.fieldErrors)[0] ??
          "Fix the highlighted fields before saving.";
        toast.notify({
          title: "Workspace brief needs attention",
          description,
          tone: "danger",
          announcement: {
            message: "Workspace brief needs attention.",
            priority: "assertive",
          },
        });
        return;
      }

      setSavedDraft(trimmed);
      toast.notify({
        title: "Workspace brief saved",
        description:
          "The starter form pattern is ready for workspace setup surfaces.",
        tone: "success",
        announcement: "Workspace brief saved.",
      });
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const canSubmit = useStore(form.store, (state) => state.canSubmit);
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const isDirty = useMemo(
    () => hasStarterFormChanges(savedDraft, values),
    [savedDraft, values],
  );
  const autosaveStatus = useStarterAutosave({
    canSubmit,
    enabled: true,
    isDirty,
    isSubmitting,
    onSave: saveDraft,
    values,
  });

  useStarterDirtyRouteGuard({ enabled: isDirty });

  return (
    <section aria-label="Workspace setup form" className="template-form-panel">
      <header>
        <p className="eyebrow">Workspace brief</p>
        <h2>Starter form pattern</h2>
        <p>
          A schema-backed TanStack Form reference for validation, dirty-state
          protection, and fake-safe autosave.
        </p>
      </header>
      <form
        className="template-form"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="workspaceName"
          validators={{
            onBlur: starterFieldValidator(
              "workspaceName",
              onboardingBriefSchema,
            ),
            onChange: starterFieldValidator(
              "workspaceName",
              onboardingBriefSchema,
            ),
          }}
        >
          {(field) => (
            <label className="template-form-field">
              <span>Workspace name</span>
              <input
                autoComplete="organization"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </label>
          )}
        </form.Field>
        <form.Field
          name="workspaceSlug"
          validators={{
            onBlur: starterFieldValidator(
              "workspaceSlug",
              onboardingBriefSchema,
            ),
            onChange: starterFieldValidator(
              "workspaceSlug",
              onboardingBriefSchema,
            ),
          }}
        >
          {(field) => (
            <label className="template-form-field">
              <span>Workspace slug</span>
              <input
                autoComplete="off"
                inputMode="text"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </label>
          )}
        </form.Field>
        <form.Field
          name="activationGoal"
          validators={{
            onBlur: starterFieldValidator(
              "activationGoal",
              onboardingBriefSchema,
            ),
            onChange: starterFieldValidator(
              "activationGoal",
              onboardingBriefSchema,
            ),
          }}
        >
          {(field) => (
            <label className="template-form-field">
              <span>Activation goal</span>
              <textarea
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                rows={3}
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </label>
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
        >
          {([submittable, submitting]) => (
            <footer className="template-form-actions">
              <span aria-live="polite" className="template-form-status">
                {isDirty
                  ? `Unsaved changes - autosave ${autosaveStatus}.`
                  : `Saved draft for ${mode} mode.`}
              </span>
              <button disabled={!submittable} type="submit">
                {submitting ? "Saving..." : "Save brief"}
              </button>
            </footer>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}

function FieldError({ errors }: { readonly errors: readonly unknown[] }) {
  const message = errors.find((error) => typeof error === "string");

  if (!message) {
    return null;
  }

  return <span className="template-form-error">{message}</span>;
}
