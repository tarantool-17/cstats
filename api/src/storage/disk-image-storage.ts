import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type StoreImageRequest = {
  bytes: Buffer;
  sha256: string;
  receivedAt: Date;
  mimeType?: string;
};

export type StoredImage = {
  absolutePath: string;
  relativePath: string;
  alreadyExists: boolean;
};

export class DiskImageStorage {
  constructor(private readonly root: string) {}

  async storeImage(request: StoreImageRequest): Promise<StoredImage> {
    const relativePath = buildRelativePath(request.receivedAt, request.sha256, request.mimeType);
    const absolutePath = join(this.root, relativePath);

    await mkdir(dirname(absolutePath), { recursive: true });

    try {
      await writeFile(absolutePath, request.bytes, { flag: 'wx' });
      return { absolutePath, relativePath, alreadyExists: false };
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return { absolutePath, relativePath, alreadyExists: true };
      }

      throw error;
    }
  }
}

function buildRelativePath(receivedAt: Date, sha256: string, mimeType?: string): string {
  const year = String(receivedAt.getUTCFullYear());
  const month = String(receivedAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(receivedAt.getUTCDate()).padStart(2, '0');

  return join(year, month, day, `${sha256}${extensionForMimeType(mimeType)}`);
}

function extensionForMimeType(mimeType?: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/jpeg':
    case 'image/jpg':
    default:
      return '.jpg';
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
