import type { NormalizedMessage } from '../normalized-message.js';
import type { OutboundMessage } from '../outbound-message.js';
import type { CommandRouter } from '../../commands/command-router.js';
import { formatError, logError, logInfo } from '../../logger.js';
import type { TelegramApi } from './telegram-api.js';
import type { TelegramConfig } from './telegram.config.js';
import { isAllowedChat } from './telegram.config.js';
import { toCommandRequest } from './telegram-command-adapter.js';
import { downloadTelegramAttachment, type DownloadedTelegramFile } from './telegram-file-downloader.js';
import { normalizeTelegramMessage } from './telegram-message-normalizer.js';
import { handleTelegramReviewCallback } from './telegram-review-callbacks.js';
import { sendTelegramResponse } from './telegram-response-renderer.js';
import type { TelegramUpdate } from './telegram.types.js';

export type ImageMessageHandler = (
  message: NormalizedMessage,
  files: DownloadedTelegramFile[]
) => Promise<OutboundMessage>;

type TelegramUpdateHandlerDependencies = {
  config: TelegramConfig;
  commandRouter: CommandRouter;
  imageMessageHandler?: ImageMessageHandler;
};

export class TelegramUpdateHandler {
  private readonly imageMessageHandler: ImageMessageHandler;

  constructor(private readonly deps: TelegramUpdateHandlerDependencies) {
    this.imageMessageHandler = deps.imageMessageHandler ?? defaultImageMessageHandler;
  }

  async handle(update: TelegramUpdate, api: TelegramApi): Promise<void> {
    if (update.callback_query) {
      await handleTelegramReviewCallback(update.callback_query, api, this.deps.config);
      return;
    }

    const message = update.message;
    if (!message) {
      return;
    }

    const chatId = String(message.chat.id);
    const traceId = String(message.message_id);
    const logFields = {
      trace_id: traceId,
      chat_id: chatId,
      update_id: update.update_id
    };

    logInfo('telegram_message_received', logFields);

    if (!isAllowedChat(this.deps.config, chatId)) {
      logInfo('telegram_message_ignored_disallowed_chat', logFields);
      return;
    }

    try {
      const command = toCommandRequest(message, this.deps.config);
      if (command) {
        await sendTelegramResponse(api, chatId, await this.deps.commandRouter.execute(command));
        logInfo('telegram_response_sent', { ...logFields, response_kind: 'command' });
        return;
      }

      const normalizedMessage = normalizeTelegramMessage(message);
      if (normalizedMessage.attachments.length === 0) {
        await sendTelegramResponse(api, chatId, {
          text: [
            'Message received.',
            `Message: ${traceId}`,
            'Please send a CS2 scoreboard image or use /help.'
          ].join('\n')
        });
        logInfo('telegram_response_sent', { ...logFields, response_kind: 'unsupported_message' });
        return;
      }

      const files = await Promise.all(
        normalizedMessage.attachments.map((attachment) => downloadTelegramAttachment(api, attachment))
      );
      logInfo('telegram_attachments_downloaded', {
        ...logFields,
        attachment_count: files.length,
        total_bytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0)
      });

      await sendTelegramResponse(api, chatId, await this.imageMessageHandler(normalizedMessage, files));
      logInfo('telegram_response_sent', { ...logFields, response_kind: 'image_ingestion' });
    } catch (error) {
      logError('telegram_message_error', logFields, error);
      await sendTelegramResponse(api, chatId, {
        text: [
          'Error was raised while processing your message.',
          `Message: ${traceId}`,
          `Reason: ${formatError(error)}`
        ].join('\n')
      });
      logInfo('telegram_response_sent', { ...logFields, response_kind: 'error' });
    }
  }
}

async function defaultImageMessageHandler(
  message: NormalizedMessage,
  files: DownloadedTelegramFile[]
): Promise<OutboundMessage> {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);

  return {
    text: [
      'Image received.',
      `Message: ${message.externalMessageId}`,
      `Downloaded bytes: ${totalBytes}`,
      'Ingestion storage is the next implementation step.'
    ].join('\n')
  };
}
