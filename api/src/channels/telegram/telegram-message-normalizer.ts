import type { NormalizedAttachment, NormalizedMessage } from '../normalized-message.js';
import type { TelegramMessage, TelegramPhotoSize } from './telegram.types.js';

export function normalizeTelegramMessage(message: TelegramMessage): NormalizedMessage {
  return {
    platform: 'telegram',
    externalChannelId: String(message.chat.id),
    externalMessageId: String(message.message_id),
    externalSenderId: message.from ? String(message.from.id) : undefined,
    senderUsername: message.from?.username,
    senderDisplayName: formatDisplayName(message.from?.first_name, message.from?.last_name),
    messageText: message.text,
    receivedAt: new Date(message.date * 1000),
    attachments: collectAttachments(message)
  };
}

function collectAttachments(message: TelegramMessage): NormalizedAttachment[] {
  const attachments: NormalizedAttachment[] = [];
  const photo = selectLargestPhoto(message.photo);

  if (photo) {
    attachments.push({
      kind: 'image',
      providerFileId: photo.file_id,
      providerUniqueFileId: photo.file_unique_id,
      width: photo.width,
      height: photo.height,
      fileSize: photo.file_size,
      mimeType: 'image/jpeg'
    });
  }

  if (message.document?.mime_type?.startsWith('image/')) {
    attachments.push({
      kind: 'image',
      providerFileId: message.document.file_id,
      providerUniqueFileId: message.document.file_unique_id,
      fileName: message.document.file_name,
      fileSize: message.document.file_size,
      mimeType: message.document.mime_type
    });
  }

  return attachments;
}

function selectLargestPhoto(photos?: TelegramPhotoSize[]): TelegramPhotoSize | undefined {
  return photos?.reduce((largest, photo) => {
    return (photo.file_size ?? 0) > (largest.file_size ?? 0) ? photo : largest;
  });
}

function formatDisplayName(firstName?: string, lastName?: string): string | undefined {
  return [firstName, lastName].filter(Boolean).join(' ') || undefined;
}
