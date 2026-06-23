import { SimpleCommandRouter } from './commands/command-router.js';
import { createTelegramConfig } from './channels/telegram/telegram.config.js';
import { TelegramBot } from './channels/telegram/telegram-bot.js';
import { TelegramUpdateHandler } from './channels/telegram/telegram-update-handler.js';

const config = createTelegramConfig(process.env);
const commandRouter = new SimpleCommandRouter();
const updateHandler = new TelegramUpdateHandler({ config, commandRouter });
const bot = new TelegramBot(config, updateHandler);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, stopping Telegram bot`);
    bot.stop();
  });
}

await bot.start();
