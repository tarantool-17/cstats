import type { OutboundButton } from '../outbound-message.js';
import type { TelegramUpdate } from './telegram.types.js';

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly apiBaseUrl: string
  ) {}

  getUpdates(offset: number | undefined, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    return this.call('getUpdates', {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query']
    });
  }

  sendMessage(chatId: string, text: string, buttons?: OutboundButton[][]): Promise<unknown> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: buttons ? { inline_keyboard: buttons.map((row) => row.map((button) => ({
        text: button.text,
        callback_data: button.callbackData
      }))) } : undefined
    });
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    return this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text
    });
  }

  getFile(fileId: string): Promise<TelegramFile> {
    return this.call('getFile', { file_id: fileId });
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const response = await fetch(`${this.apiBaseUrl}/file/bot${this.token}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    const payload = await response.json() as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description ?? `Telegram API call failed: ${method}`);
    }

    return payload.result;
  }
}
