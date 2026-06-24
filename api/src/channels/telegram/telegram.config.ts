export type TelegramConfig = {
  botToken: string;
  mode: 'polling';
  pollingTimeoutSeconds: number;
  allowedChatIds: Set<string>;
  adminUserIds: Set<string>;
  apiBaseUrl: string;
};

type Env = Record<string, string | undefined>;

export function createTelegramConfig(env: Env): TelegramConfig {
  const botToken = requireEnv(env, 'TELEGRAM_BOT_TOKEN');

  return {
    botToken,
    mode: 'polling',
    pollingTimeoutSeconds: readPositiveInt(env.TELEGRAM_POLLING_TIMEOUT_SECONDS, 10),
    allowedChatIds: readCsvSet(env.TELEGRAM_ALLOWED_CHAT_IDS),
    adminUserIds: readCsvSet(env.TELEGRAM_ADMIN_USER_IDS),
    apiBaseUrl: env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org'
  };
}

export function isAllowedChat(config: TelegramConfig, chatId: string): boolean {
  return config.allowedChatIds.size === 0 || config.allowedChatIds.has(chatId);
}

export function isAdmin(config: TelegramConfig, userId?: string): boolean {
  return Boolean(userId && config.adminUserIds.has(userId));
}

function requireEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readCsvSet(value?: string): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
