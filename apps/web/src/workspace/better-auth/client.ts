export const authClient = {
  useSession: () => ({ data: null }),
  signIn: {
    email: async (input: { email: string; password: string }) => {
      void input;
    },
  },
  signUp: {
    email: async (input: { email: string; password: string }) => {
      void input;
    },
  },
  signOut: async () => undefined,
};
