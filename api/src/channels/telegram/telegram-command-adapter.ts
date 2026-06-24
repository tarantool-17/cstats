import type { CommandRequest } from '../../commands/command-router.js';
import type { TelegramConfig } from './telegram.config.js';
import { isAdmin } from './telegram.config.js';
import type { TelegramMessage } from './telegram.types.js';

export function toCommandRequest(message: TelegramMessage, config: TelegramConfig): CommandRequest | null {
  const text = message.text?.trim();
  if (!text?.startsWith('/')) {
    return null;
  }

  const [rawCommand, ...args] = text.slice(1).split(/\s+/);
  const name = rawCommand.split('@')[0]?.toLowerCase();
  if (!name) {
    return null;
  }

  const senderId = message.from ? String(message.from.id) : undefined;

  return {
    name,
    args,
    rawText: text,
    externalChannelId: String(message.chat.id),
    externalSenderId: senderId,
    isAdmin: isAdmin(config, senderId)
  };
}
