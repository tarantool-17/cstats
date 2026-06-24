import { TelegramApi } from './telegram-api.js';
import type { TelegramConfig } from './telegram.config.js';
import type { TelegramUpdateHandler } from './telegram-update-handler.js';

const RETRY_DELAY_MS = 1000;

export class TelegramBot {
  private readonly api: TelegramApi;
  private running = false;
  private offset: number | undefined;

  constructor(
    private readonly config: TelegramConfig,
    private readonly updateHandler: TelegramUpdateHandler
  ) {
    this.api = new TelegramApi(config.botToken, config.apiBaseUrl);
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`Telegram bot started in polling mode (${this.config.pollingTimeoutSeconds}s timeout)`);

    while (this.running) {
      try {
        const updates = await this.api.getUpdates(this.offset, this.config.pollingTimeoutSeconds);

        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.updateHandler.handle(update, this.api);
        }
      } catch (error) {
        console.error('Telegram polling failed', error);
        await sleep(RETRY_DELAY_MS);
      }
    }

    console.log('Telegram bot stopped');
  }

  stop(): void {
    this.running = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
