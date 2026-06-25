import { TelegramApi } from './telegram-api.js';
import type { TelegramConfig } from './telegram.config.js';
import type { TelegramUpdateHandler } from './telegram-update-handler.js';
import { logError, logInfo } from '../../logger.js';

const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

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
    let consecutiveFailures = 0;
    console.log(`Telegram bot started in polling mode (${this.config.pollingTimeoutSeconds}s timeout)`);

    while (this.running) {
      try {
        const updates = await this.api.getUpdates(this.offset, this.config.pollingTimeoutSeconds);
        if (consecutiveFailures > 0) {
          logInfo('telegram_polling_recovered', { failed_attempts: consecutiveFailures });
          consecutiveFailures = 0;
        }

        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.updateHandler.handle(update, this.api);
        }
      } catch (error) {
        consecutiveFailures += 1;
        const retryDelayMs = calculateRetryDelayMs(consecutiveFailures);

        logError('telegram_polling_failed', {
          attempt: consecutiveFailures,
          retry_delay_ms: retryDelayMs,
          error_code: readErrorCode(error),
          cause: readErrorCauseMessage(error)
        }, error);

        await sleep(retryDelayMs);
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

function calculateRetryDelayMs(attempt: number): number {
  return Math.min(INITIAL_RETRY_DELAY_MS * 2 ** Math.min(attempt - 1, 5), MAX_RETRY_DELAY_MS);
}

function readErrorCode(error: unknown): string | undefined {
  return readStringProperty(error, 'code') ?? readStringProperty(readCause(error), 'code');
}

function readErrorCauseMessage(error: unknown): string | undefined {
  const cause = readCause(error);
  return cause instanceof Error ? cause.message : undefined;
}

function readCause(error: unknown): unknown {
  return error instanceof Error ? error.cause : undefined;
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || !(key in value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}
