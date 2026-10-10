// Transient storage for uploaded invoices under review, in a private local
// directory kept out of database backups (MAPPING.md).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DocumentStore {
  put(bytes: Buffer): Promise<string>;
  // Undefined once deleted (or lost, e.g. a restarted container).
  get(storageReference: string): Promise<Buffer | undefined>;
  delete(storageReference: string): Promise<void>;
}

const PREFIX = 'local:';

export function localDocumentStore(directory: string): DocumentStore {
  const pathFor = (storageReference: string): string => {
    const name = storageReference.startsWith(PREFIX) ? storageReference.slice(PREFIX.length) : '';
    // Only names this store issued; never a caller-supplied path.
    if (!/^[0-9a-f-]{36}$/.test(name)) {
      throw new Error(`Unknown storage reference: ${storageReference}`);
    }
    return join(directory, name);
  };

  return {
    async put(bytes) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const name = randomUUID();
      await writeFile(join(directory, name), bytes, { mode: 0o600, flag: 'wx' });
      return `${PREFIX}${name}`;
    },
    async get(storageReference) {
      try {
        return await readFile(pathFor(storageReference));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    },
    async delete(storageReference) {
      await rm(pathFor(storageReference), { force: true });
    },
  };
}

export const documentStore = localDocumentStore(
  process.env.DOCUMENT_STORE_DIR || join(tmpdir(), 'case-management-documents'),
);
