import type { OutboundMessage } from '../outbound-message.js';
import type { TelegramApi } from './telegram-api.js';

export function sendTelegramResponse(
  api: TelegramApi,
  chatId: string,
  message: OutboundMessage
): Promise<unknown> {
  return api.sendMessage(chatId, message.text, message.buttons);
}
