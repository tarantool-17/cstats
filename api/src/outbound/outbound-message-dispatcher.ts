import type { TelegramApi } from '../channels/telegram/telegram-api.js';
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
      console.log(`Sent outbound message ${message.id}`);
    } catch (error) {
      await this.messages.markFailed(message.id, error);
      console.error(`Failed outbound message ${message.id}`, error);
    }

    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
