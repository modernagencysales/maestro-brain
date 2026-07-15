import { ConnectSessionInvalid, isSecretShapedNangoValue } from "./client";

export type NangoConnectOpen = (input: {
  readonly token: string;
}) => Promise<{ readonly connectionId: string }>;

export const openNangoConnect = async (input: {
  readonly connectSessionToken: string;
  readonly expiresAt: number;
  readonly open: NangoConnectOpen;
  readonly now?: number;
}): Promise<{ readonly connectionId: string }> => {
  if (
    input.expiresAt <= (input.now ?? Date.now()) ||
    isSecretShapedNangoValue(input.connectSessionToken) ||
    !input.connectSessionToken.startsWith("connect_public_")
  ) {
    throw new ConnectSessionInvalid();
  }

  return input.open({ token: input.connectSessionToken });
};
