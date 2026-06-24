export type WorkerConfig = {
  databaseUrl: string;
  imageStorageRoot: string;
  pollIntervalMs: number;
  scoreboardModel?: ScoreboardModelConfig;
  workerId: string;
};

export type ScoreboardModelConfig = {
  endpointUrl: string;
  modelName: string;
  maxTokens: number;
  timeoutMs: number;
};

type Env = Record<string, string | undefined>;

export function createWorkerConfig(env: Env): WorkerConfig {
  return {
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    imageStorageRoot: env.IMAGE_STORAGE_ROOT ?? '/tmp/cstats/images',
    pollIntervalMs: readPositiveInt(env.WORKER_POLL_INTERVAL_MS, 5000),
    scoreboardModel: readScoreboardModelConfig(env),
    workerId: env.WORKER_ID ?? `worker-${process.pid}`
  };
}

function readScoreboardModelConfig(env: Env): ScoreboardModelConfig | undefined {
  const endpointUrl = env.SCOREBOARD_MODEL_URL;
  const modelName = env.SCOREBOARD_MODEL_NAME;

  if (!endpointUrl && !modelName) {
    return undefined;
  }

  if (!endpointUrl || !modelName) {
    throw new Error('Both SCOREBOARD_MODEL_URL and SCOREBOARD_MODEL_NAME are required when enabling scoreboard OCR');
  }

  return {
    endpointUrl,
    modelName,
    maxTokens: readPositiveInt(env.SCOREBOARD_MODEL_MAX_TOKENS, 2048),
    timeoutMs: readPositiveInt(env.SCOREBOARD_MODEL_TIMEOUT_MS, 180000)
  };
}

function requireEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
