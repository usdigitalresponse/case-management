import { vi } from 'vitest';

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
}

export interface FakeResponse {
  status: number;
  body: unknown;
}

// A reply other than 200.
export const respond = (status: number, body: unknown = {}): FakeResponse => ({ status, body });

type Handler = ((request: FakeRequest) => unknown) | object;
const isResponse = (value: unknown): value is FakeResponse =>
  typeof value === 'object' && value !== null && 'status' in value && 'body' in value && Object.keys(value).length === 2;

// Stands in for the server: routes are 'METHOD /path/:param'. Every request is
// recorded; one with no route fails the test instead of being guessed at.
export function fakeApi(routes: Record<string, Handler>) {
  const calls: FakeRequest[] = [];
  const unhandled: string[] = [];
  const table = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(' ') as [string, string];
    const names: string[] = [];
    const source = pattern.replace(/:(\w+)/g, (_, name: string) => {
      names.push(name);
      return '([^/]+)';
    });
    return { method, regex: new RegExp(`^${source}$`), names, handler };
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const method = (init.method ?? 'GET').toUpperCase();
      let body: unknown;
      try {
        body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      } catch {
        body = init.body;
      }
      const found = table
        .filter((route) => route.method === method)
        .map((route) => ({ route, match: route.regex.exec(url.pathname) }))
        .find(({ match }) => match);
      if (found) {
        const { route, match } = found;
        const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match![index + 1]!)]));
        const request = { method, path: url.pathname, query: url.searchParams, params, body };
        calls.push(request);
        const result = typeof route.handler === 'function' ? await (route.handler as (r: FakeRequest) => unknown)(request) : route.handler;
        const { status, body: reply } = isResponse(result) ? result : { status: 200, body: result };
        return new Response(JSON.stringify(reply ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
      }
      unhandled.push(`${method} ${url.pathname}${url.search}`);
      // eslint-disable-next-line no-console
      console.warn(`fakeApi: no route for ${method} ${url.pathname}${url.search}`);
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    }),
  );

  return {
    calls,
    unhandled,
    // The requests made to one route, in order.
    callsTo: (method: string, path: string | RegExp) =>
      calls.filter((call) => call.method === method && (typeof path === 'string' ? call.path === path : path.test(call.path))),
  };
}
