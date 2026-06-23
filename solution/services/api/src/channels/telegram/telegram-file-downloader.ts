import type { NormalizedAttachment } from '../normalized-message.js';
import type { TelegramApi } from './telegram-api.js';

export type DownloadedTelegramFile = {
  attachment: NormalizedAttachment;
  bytes: Buffer;
  telegramFilePath: string;
};

export async function downloadTelegramAttachment(
  api: TelegramApi,
  attachment: NormalizedAttachment
): Promise<DownloadedTelegramFile> {
  const file = await api.getFile(attachment.providerFileId);
  if (!file.file_path) {
    throw new Error(`Telegram file path is missing for ${attachment.providerFileId}`);
  }

  return {
    attachment,
    bytes: await api.downloadFile(file.file_path),
    telegramFilePath: file.file_path
  };
}
