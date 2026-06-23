export type ChannelPlatform = 'telegram';

export type NormalizedAttachment = {
  kind: 'image';
  providerFileId: string;
  providerUniqueFileId?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
};

export type NormalizedMessage = {
  platform: ChannelPlatform;
  externalChannelId: string;
  externalMessageId: string;
  externalSenderId?: string;
  senderUsername?: string;
  senderDisplayName?: string;
  messageText?: string;
  receivedAt: Date;
  attachments: NormalizedAttachment[];
};
