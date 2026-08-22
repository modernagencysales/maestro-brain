import * as React from "react";

import { Button, ButtonProps } from "@chakra-ui/react";
import { createLink } from "@tanstack/react-router";

export interface LinkButtonProps extends ButtonProps {
  href?: string | object;
}

export const LinkButton = createLink(
  React.forwardRef(function LinkButton(
    props: LinkButtonProps,
    ref: React.ForwardedRef<HTMLAnchorElement>,
  ) {
    return (
      <Button asChild {...props}>
        <a ref={ref} />
      </Button>
    );
  }),
);
