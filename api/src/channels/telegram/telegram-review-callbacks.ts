import type { TelegramApi } from './telegram-api.js';
import type { TelegramConfig } from './telegram.config.js';
import { isAdmin } from './telegram.config.js';
import type { TelegramCallbackQuery } from './telegram.types.js';

export async function handleTelegramReviewCallback(
  callback: TelegramCallbackQuery,
  api: TelegramApi,
  config: TelegramConfig
): Promise<void> {
  const userId = String(callback.from.id);

  if (!isAdmin(config, userId)) {
    await api.answerCallbackQuery(callback.id, 'Admin only');
    return;
  }

  if (!callback.data?.startsWith('review:')) {
    await api.answerCallbackQuery(callback.id);
    return;
  }

  await api.answerCallbackQuery(callback.id, 'Review actions are not wired yet');
}
