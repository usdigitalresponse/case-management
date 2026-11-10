import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(app: Express): Promise<TestServer> {
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export type Call = (method: string, path: string, body?: unknown) => Promise<Response>;

export function caller(server: TestServer, cookie?: string): Call {
  return (method, path, body) =>
    fetch(`${server.url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

// Signs in through a demo sign-in route and returns a caller holding its session.
export async function signIn(server: TestServer, path: '/auth/demo-login' | '/auth/demo-login/external', userAccountId: string): Promise<Call> {
  const response = await caller(server)('POST', path, { userAccountId });
  if (!response.ok) {
    throw new Error(`Sign-in failed with ${response.status}: ${await response.text()}`);
  }
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  return caller(server, cookie);
}
