import { describe, expect, it } from "vitest";
import {
  hasStarterFormChanges,
  planStarterAutosave,
  starterFieldValidator,
  starterSlugPattern,
  trimStarterFormValues,
  validateStarterForm,
  type StarterFormSchema,
} from "./starter-form";

type WorkspaceBriefValues = {
  readonly workspaceName: string;
  readonly workspaceSlug: string;
};

const schema: StarterFormSchema<WorkspaceBriefValues> = {
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
};

describe("starter form primitives", () => {
  it("trims values before validation and change detection", () => {
    expect(
      trimStarterFormValues({
        workspaceName: "  Acme  ",
        workspaceSlug: " acme ",
      }),
    ).toEqual({
      workspaceName: "Acme",
      workspaceSlug: "acme",
    });

    expect(
      hasStarterFormChanges(
        { workspaceName: "Acme", workspaceSlug: "acme" },
        { workspaceName: " Acme ", workspaceSlug: "acme" },
      ),
    ).toBe(false);
  });

  it("returns field errors for required, max-length, and pattern failures", () => {
    expect(
      validateStarterForm(
        {
          workspaceName: "",
          workspaceSlug: "Bad Slug",
        },
        schema,
      ),
    ).toEqual({
      isValid: false,
      fieldErrors: {
        workspaceName: "Workspace name is required.",
        workspaceSlug:
          "Workspace slug can use lowercase letters, numbers, and hyphens.",
      },
    });

    expect(
      validateStarterForm(
        {
          workspaceName: "a".repeat(65),
          workspaceSlug: "acme",
        },
        schema,
      ).fieldErrors.workspaceName,
    ).toBe("Workspace name must be 64 characters or fewer.");
  });

  it("creates TanStack field validators from the same schema", () => {
    const validateSlug = starterFieldValidator("workspaceSlug", schema);

    expect(validateSlug({ value: "acme-client" })).toBeUndefined();
    expect(validateSlug({ value: "Acme Client" })).toBe(
      "Workspace slug can use lowercase letters, numbers, and hyphens.",
    );
  });

  it("plans autosave only when a dirty valid form is past debounce", () => {
    expect(
      planStarterAutosave({
        canSubmit: true,
        debounceMs: 500,
        enabled: false,
        isDirty: true,
        isSubmitting: false,
        lastChangedAt: 1000,
        now: 2000,
      }),
    ).toEqual({ status: "skip", reason: "disabled" });

    expect(
      planStarterAutosave({
        canSubmit: false,
        debounceMs: 500,
        enabled: true,
        isDirty: true,
        isSubmitting: false,
        lastChangedAt: 1000,
        now: 2000,
      }),
    ).toEqual({ status: "skip", reason: "invalid" });

    expect(
      planStarterAutosave({
        canSubmit: true,
        debounceMs: 500,
        enabled: true,
        isDirty: true,
        isSubmitting: false,
        lastChangedAt: 1000,
        now: 1200,
      }),
    ).toEqual({ status: "save", dueInMs: 300 });

    expect(
      planStarterAutosave({
        canSubmit: true,
        debounceMs: 500,
        enabled: true,
        isDirty: true,
        isSubmitting: false,
        lastChangedAt: 1000,
        now: 1500,
      }),
    ).toEqual({ status: "save", dueInMs: 0 });
  });
});
