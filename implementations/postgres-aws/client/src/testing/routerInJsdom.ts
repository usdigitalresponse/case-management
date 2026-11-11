// jsdom's AbortSignal isn't the one Node's Request accepts; these tests have no loaders to abort.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    const { signal: _signal, ...rest } = init;
    super(input, rest);
  }
};
