import type { Ref } from "@confect/core";
import type { ReactMutation } from "@confect/react";
import type { TemplateConfectRefs } from "@maestro-template/convex/refs";
import { describe, expectTypeOf, it } from "vitest";
import {
  type TemplateDataState,
  type TemplateMutationState,
  useTemplateMutation,
  useTemplateQuery,
} from "./confect-state";

type BrainPageListRef = TemplateConfectRefs["public"]["brain"]["pages"]["list"];
type BrainPageCreateRef =
  TemplateConfectRefs["public"]["brain"]["pages"]["createMarkdown"];
type TemplateQueryResult<Query extends Ref.AnyPublicQuery> = ReturnType<
  typeof useTemplateQuery<Query>
>;
type TemplateMutationResult<Mutation extends Ref.AnyPublicMutation> =
  ReturnType<typeof useTemplateMutation<Mutation>>;
type WorkspaceNotFoundVariant<Error> = Extract<
  Error,
  { readonly _tag: "WorkspaceNotFound" }
>;

describe("generated Confect refs through the web adapter", () => {
  it("infers generated query args, returns, and typed failures", () => {
    expectTypeOf<BrainPageListRef>().toMatchTypeOf<Ref.AnyPublicQuery>();
    expectTypeOf<Ref.Args<BrainPageListRef>>().toHaveProperty("workspaceId");
    expectTypeOf<Ref.Returns<BrainPageListRef>>().toMatchTypeOf<
      ReadonlyArray<{ readonly workspaceId: string; readonly title: string }>
    >();
    expectTypeOf<WorkspaceNotFoundVariant<Ref.Error<BrainPageListRef>>>()
      .toHaveProperty("workspaceId")
      .toEqualTypeOf<string>();

    expectTypeOf<TemplateQueryResult<BrainPageListRef>>().toEqualTypeOf<
      TemplateDataState<
        Ref.Returns<BrainPageListRef>,
        Ref.Error<BrainPageListRef>
      >
    >();
  });

  it("infers generated mutation args, results, and typed failures", () => {
    expectTypeOf<BrainPageCreateRef>().toMatchTypeOf<Ref.AnyPublicMutation>();
    expectTypeOf<Ref.Args<BrainPageCreateRef>>().toMatchTypeOf<{
      readonly workspaceId: string;
      readonly slug: string;
      readonly title: string;
      readonly markdown: string;
    }>();
    expectTypeOf<Ref.Returns<BrainPageCreateRef>>().toMatchTypeOf<string>();
    expectTypeOf<WorkspaceNotFoundVariant<Ref.Error<BrainPageCreateRef>>>()
      .toHaveProperty("workspaceId")
      .toEqualTypeOf<string>();

    expectTypeOf<TemplateMutationResult<BrainPageCreateRef>>().toEqualTypeOf<
      ReactMutation<BrainPageCreateRef>
    >();
    expectTypeOf<
      Extract<
        TemplateMutationState<
          Ref.Returns<BrainPageCreateRef>,
          Ref.Error<BrainPageCreateRef>
        >,
        { readonly mutation: "success" }
      >["data"]
    >().toEqualTypeOf<Ref.Returns<BrainPageCreateRef>>();
    expectTypeOf<
      Extract<
        TemplateMutationState<
          Ref.Returns<BrainPageCreateRef>,
          Ref.Error<BrainPageCreateRef>
        >,
        { readonly status: "typed_failure" }
      >["error"]
    >().toEqualTypeOf<Ref.Error<BrainPageCreateRef>>();
  });
});
