import { createHash } from 'node:crypto';
import type { NormalizedAttachment, NormalizedMessage } from '../channels/normalized-message.js';
import type { DiskImageStorage, StoredImage } from '../storage/disk-image-storage.js';
import type { DatabaseIngestionResult, IngestionRepository } from './ingestion.repository.js';
import { parsePhotoDateTimeFromFilename } from './photo-datetime.js';

export type DownloadedImageFile = {
  attachment: NormalizedAttachment;
  bytes: Buffer;
  telegramFilePath?: string;
};

export type IngestedImage = {
  attachment: NormalizedAttachment;
  sha256: string;
  byteLength: number;
  capturedAt: Date | null;
  storage: StoredImage;
  sourceFileName: string | null;
  telegramFilePath: string | null;
};

export type IngestionResult = {
  sourceMessage: NormalizedMessage;
  images: IngestedImage[];
  database?: DatabaseIngestionResult;
};

export class IngestionService {
  constructor(
    private readonly imageStorage: DiskImageStorage,
    private readonly repository?: IngestionRepository,
    private readonly filenameTimeZone = 'Europe/Warsaw'
  ) {}

  async ingestImageMessage(
    message: NormalizedMessage,
    files: DownloadedImageFile[]
  ): Promise<IngestionResult> {
    const images = await Promise.all(
      files.map(async (file) => {
        const sha256 = hashSha256(file.bytes);
        const sourceFileName = file.attachment.fileName ?? null;
        const telegramFilePath = file.telegramFilePath ?? null;
        const capturedAt = [
          sourceFileName,
          basenameFromPath(telegramFilePath),
          telegramFilePath
        ].reduce<Date | null>(
          (parsed, candidate) => parsed ?? parsePhotoDateTimeFromFilename(candidate, this.filenameTimeZone),
          null
        );
        const storage = await this.imageStorage.storeImage({
          bytes: file.bytes,
          sha256,
          receivedAt: message.receivedAt,
          mimeType: file.attachment.mimeType
        });

        return {
          attachment: file.attachment,
          sha256,
          byteLength: file.bytes.byteLength,
          capturedAt,
          storage,
          sourceFileName,
          telegramFilePath
        };
      })
    );

    return {
      sourceMessage: message,
      images,
      database: await this.repository?.recordImageMessage(message, images)
    };
  }
}

function hashSha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function basenameFromPath(value: string | null): string | null {
  return value?.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
}
