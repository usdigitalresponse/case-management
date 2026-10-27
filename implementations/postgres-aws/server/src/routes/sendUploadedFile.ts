import type { Response } from 'express';
import { previewFile } from '../imports/preview';

interface UploadedFile {
  fileName: string;
  mediaType: string;
  bytes: Buffer;
}

export async function sendFilePreview(res: Response, file: UploadedFile): Promise<void> {
  res.set('Cache-Control', 'no-store').json(await previewFile(file.mediaType, file.bytes));
}

// Always a download, so uploaded content never renders in the app's origin.
export function sendFileDownload(res: Response, file: UploadedFile): void {
  res
    .type(file.mediaType)
    .attachment(file.fileName)
    .set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    .send(file.bytes);
}
