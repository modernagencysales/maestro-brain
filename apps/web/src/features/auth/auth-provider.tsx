import React from "react";

import { AuthProvider as BaseAuthProvider } from "@saas-ui/auth-provider";

import { authClient } from "@workspace/better-auth/client";

export const client = authClient;

export const authService = {
  onLoadUser: async () => null,
  onLogin: async (params: { email?: string; password?: string }) => {
    if (params.email !== undefined && params.password !== undefined)
      await client.signIn.email({
        email: params.email,
        password: params.password,
      });
    return null;
  },
  onSignup: async (params: { email?: string; password?: string }) => {
    if (params.email !== undefined && params.password !== undefined)
      await client.signUp.email({
        email: params.email,
        password: params.password,
      });
    return null;
  },
  onLogout: async () => client.signOut(),
};

export function AuthProvider(props: { children: React.ReactNode }) {
  return <BaseAuthProvider {...authService}>{props.children}</BaseAuthProvider>;
}
