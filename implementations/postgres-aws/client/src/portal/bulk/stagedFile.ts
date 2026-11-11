import { type CaseSplitPreview } from '../../api/client';

export interface StagedFile {
  key: string;
  file: File;
  // One case and whom it bills, or one person for several cases
  // (./bulkImport.ts); empty until chosen.
  choice: string;
  uploading?: boolean;
  error?: string;
  // For one person: the server's read of the file, then the file's lines,
  // waiting for each to be given a case.
  splitReadId?: string;
  split?: CaseSplitPreview;
}
