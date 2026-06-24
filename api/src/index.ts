import { SimpleCommandRouter } from './commands/command-router.js';
import { createTelegramConfig } from './channels/telegram/telegram.config.js';
import { TelegramApi } from './channels/telegram/telegram-api.js';
import { TelegramBot } from './channels/telegram/telegram-bot.js';
import { TelegramUpdateHandler } from './channels/telegram/telegram-update-handler.js';
import { PostgresIngestionRepository } from './db/postgres-ingestion.repository.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { renderIngestionResult } from './ingestion/ingestion-response-renderer.js';
import { OutboundMessageDispatcher } from './outbound/outbound-message-dispatcher.js';
import { PostgresOutboundMessageRepository } from './outbound/outbound-message.repository.js';
import { DiskImageStorage } from './storage/disk-image-storage.js';

const config = createTelegramConfig(process.env);
const commandRouter = new SimpleCommandRouter();
const imageStorageRoot = process.env.IMAGE_STORAGE_ROOT ?? '/tmp/cstats/images';
const ingestionRepository = process.env.DATABASE_URL
  ? new PostgresIngestionRepository(process.env.DATABASE_URL)
  : undefined;
const outboundRepository = process.env.DATABASE_URL
  ? new PostgresOutboundMessageRepository(process.env.DATABASE_URL)
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
const outboundDispatcher = outboundRepository
  ? new OutboundMessageDispatcher(
    {
      dispatcherId: process.env.OUTBOUND_DISPATCHER_ID ?? `telegram-dispatcher-${process.pid}`,
      pollIntervalMs: readPositiveInt(process.env.OUTBOUND_POLL_INTERVAL_MS, 2000)
    },
    outboundRepository,
    new TelegramApi(config.botToken, config.apiBaseUrl)
  )
  : undefined;

if (!ingestionRepository) {
  console.warn('DATABASE_URL is not set; ingestion will save files only');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, stopping Telegram services`);
    bot.stop();
    outboundDispatcher?.stop();
  });
}

await Promise.all([
  bot.start(),
  outboundDispatcher?.start() ?? Promise.resolve()
]);

await ingestionRepository?.close();
await outboundRepository?.close();

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
