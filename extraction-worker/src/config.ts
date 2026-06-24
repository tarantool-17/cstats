export type WorkerConfig = {
  databaseUrl: string;
  imageStorageRoot: string;
  pollIntervalMs: number;
  workerId: string;
};

type Env = Record<string, string | undefined>;

export function createWorkerConfig(env: Env): WorkerConfig {
  return {
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    imageStorageRoot: env.IMAGE_STORAGE_ROOT ?? '/tmp/cstats/images',
    pollIntervalMs: readPositiveInt(env.WORKER_POLL_INTERVAL_MS, 5000),
    workerId: env.WORKER_ID ?? `worker-${process.pid}`
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
