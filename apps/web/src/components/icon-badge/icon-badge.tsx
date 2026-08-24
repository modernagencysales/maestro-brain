"use client";

import * as React from "react";
import { cloneElement, isValidElement } from "react";

import {
  type HTMLChakraProps,
  type RecipeVariantProps,
  chakra,
  useRecipe,
} from "@chakra-ui/react/styled-system";
import type { RecipeProps } from "@saas-ui/chakra-preset";
import { iconBadgeRecipe } from "@saas-ui/chakra-preset/recipes/icon-badge";

type IconBadgeVariantProps = RecipeVariantProps<typeof iconBadgeRecipe>;

export interface IconBadgeProps
  extends
    HTMLChakraProps<"div">,
    RecipeProps<"suiIconBadge", IconBadgeVariantProps>,
    IconBadgeVariantProps {
  readonly icon?: React.ReactNode;
  readonly "aria-label"?: string;
}

/** Canonical maestro-template-saas-ui IconBadge primitive. */
export const IconBadge = React.forwardRef<HTMLDivElement, IconBadgeProps>(
  function IconBadge({ icon, children, ...props }, ref) {
    const recipe = useRecipe({
      key: "suiIconBadge",
      recipe: props.recipe ?? iconBadgeRecipe,
    });
    const [variantProps, localProps] = recipe.splitVariantProps(props);
    const styles = recipe(variantProps);
    const element = icon ?? children;
    const child = isValidElement(element)
      ? cloneElement(element, {
          "aria-hidden": true,
          focusable: false,
        } as React.HTMLAttributes<HTMLElement>)
      : null;

    return (
      <chakra.div
        ref={ref}
        {...localProps}
        css={[styles, props.css]}
        className={[recipe.className, props.className]
          .filter(Boolean)
          .join(" ")}
      >
        {child}
      </chakra.div>
    );
  },
);
