import { randomUUID } from 'node:crypto';
import type { DocumentStore } from '../src/imports/documentStore';

export function memoryStore(): DocumentStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    put: async (bytes) => {
      const reference = `memory:${randomUUID()}`;
      files.set(reference, bytes);
      return reference;
    },
    get: async (reference) => files.get(reference),
    delete: async (reference) => {
      files.delete(reference);
    },
    list: async () => [...files.keys()],
  };
}
