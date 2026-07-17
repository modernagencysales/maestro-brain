import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";

const LOOPBACK_HOST = "127.0.0.1";
const AUTHORITY_PATTERN = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/;

interface ActiveLease {
  readonly authority: string;
  readonly server: Server;
}

const activeByToken = new Map<string, ActiveLease>();

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;

const validateKey = (key: string): void => {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 4096 ||
    key.includes("\0")
  )
    throw new Error("review aggregation socket lease key is invalid");
};

const recordedPort = (authority: string): number => {
  const match = AUTHORITY_PATTERN.exec(authority);
  const port = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("review aggregation socket lease authority is invalid");
  return port;
};

const listen = async (port: number): Promise<Server> => {
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ exclusive: true, host: LOOPBACK_HOST, port });
    });
  } catch (error) {
    if (errorCode(error) === "EADDRINUSE")
      throw new Error("review aggregation socket lease is already held");
    throw error;
  }
  return server;
};

const serverAuthority = (server: Server): string => {
  const address = server.address();
  if (
    typeof address !== "object" ||
    address === null ||
    address.address !== LOOPBACK_HOST ||
    !Number.isSafeInteger(address.port) ||
    address.port < 1 ||
    address.port > 65_535
  )
    throw new Error("review aggregation socket lease authority is invalid");
  return `${LOOPBACK_HOST}:${address.port}`;
};

export const acquireReviewAggregationSocketLease = async (
  key: string,
  recordedAuthority?: string,
): Promise<{ readonly token: string; readonly authority: string }> => {
  validateKey(key);
  const port =
    recordedAuthority === undefined ? 0 : recordedPort(recordedAuthority);
  const server = await listen(port);
  const authority = serverAuthority(server);
  if (recordedAuthority !== undefined && authority !== recordedAuthority) {
    server.close();
    throw new Error("review aggregation socket lease authority changed");
  }
  const token = randomUUID();
  activeByToken.set(token, { authority, server });
  return { token, authority };
};

export const releaseReviewAggregationSocketLease = async (
  token: string,
): Promise<void> => {
  const lease = activeByToken.get(token);
  if (!lease)
    throw new Error("review aggregation socket lease token is not active");
  await new Promise<void>((resolve, reject) => {
    lease.server.close((error) => (error ? reject(error) : resolve()));
  });
  activeByToken.delete(token);
};
