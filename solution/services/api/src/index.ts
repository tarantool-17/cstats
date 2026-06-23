import { SimpleCommandRouter } from './commands/command-router.js';
import { createTelegramConfig } from './channels/telegram/telegram.config.js';
import { TelegramBot } from './channels/telegram/telegram-bot.js';
import { TelegramUpdateHandler } from './channels/telegram/telegram-update-handler.js';
import { PostgresIngestionRepository } from './db/postgres-ingestion.repository.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { renderIngestionResult } from './ingestion/ingestion-response-renderer.js';
import { DiskImageStorage } from './storage/disk-image-storage.js';

const config = createTelegramConfig(process.env);
const commandRouter = new SimpleCommandRouter();
const imageStorageRoot = process.env.IMAGE_STORAGE_ROOT ?? '/tmp/cstats/images';
const ingestionRepository = process.env.DATABASE_URL
  ? new PostgresIngestionRepository(process.env.DATABASE_URL)
  : undefined;
const ingestionService = new IngestionService(new DiskImageStorage(imageStorageRoot), ingestionRepository);
const updateHandler = new TelegramUpdateHandler({
  config,
  commandRouter,
  imageMessageHandler: async (message, files) => {
    return renderIngestionResult(await ingestionService.ingestImageMessage(message, files));
  }
});
const bot = new TelegramBot(config, updateHandler);

if (!ingestionRepository) {
  console.warn('DATABASE_URL is not set; ingestion will save files only');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, stopping Telegram bot`);
    bot.stop();
  });
}

await bot.start();
await ingestionRepository?.close();
