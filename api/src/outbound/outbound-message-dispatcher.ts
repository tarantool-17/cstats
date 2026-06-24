import type { TelegramApi } from '../channels/telegram/telegram-api.js';
import { logError, logInfo } from '../logger.js';
import type { OutboundMessageRepository } from './outbound-message.repository.js';

export type OutboundDispatcherConfig = {
  dispatcherId: string;
  pollIntervalMs: number;
};

export class OutboundMessageDispatcher {
  private running = false;

  constructor(
    private readonly config: OutboundDispatcherConfig,
    private readonly messages: OutboundMessageRepository,
    private readonly telegram: Pick<TelegramApi, 'sendMessage'>
  ) {}

  async start(): Promise<void> {
    this.running = true;
    console.log(`Outbound dispatcher ${this.config.dispatcherId} started`);

    while (this.running) {
      try {
        const worked = await this.workOnce();
        if (!worked) {
          await sleep(this.config.pollIntervalMs);
        }
      } catch (error) {
        console.error('Outbound dispatcher failed', error);
        await sleep(this.config.pollIntervalMs);
      }
    }

    console.log(`Outbound dispatcher ${this.config.dispatcherId} stopped`);
  }

  stop(): void {
    this.running = false;
  }

  async workOnce(): Promise<boolean> {
    const message = await this.messages.claimNext(this.config.dispatcherId);
    if (!message) {
      return false;
    }

    try {
      if (message.platform !== 'telegram') {
        throw new Error(`Unsupported outbound platform: ${message.platform}`);
      }

      await this.telegram.sendMessage(message.externalChannelId, message.text);
      await this.messages.markSent(message.id);
      logInfo('telegram_outbound_sent', {
        trace_id: message.traceId ?? `outbound-${message.id}`,
        outbound_message_id: message.id,
        chat_id: message.externalChannelId
      });
    } catch (error) {
      await this.messages.markFailed(message.id, error);
      logError('telegram_outbound_failed', {
        trace_id: message.traceId ?? `outbound-${message.id}`,
        outbound_message_id: message.id,
        chat_id: message.externalChannelId
      }, error);
    }

    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
