import type { ClaimedExtractionJob } from './extraction-job.repository.js';

export type MatchStats = {
  rank: string;
  kills: number;
  deaths: number;
  damage: number;
};

export function extractMatchStats(job: ClaimedExtractionJob): MatchStats {
  const seed = job.imageAssetId + job.id;

  return {
    rank: `#${(seed % 16) + 1}`,
    kills: (seed * 3) % 31,
    deaths: (seed * 5) % 24,
    damage: 300 + ((seed * 137) % 2400)
  };
}

export function renderStatsNotification(job: ClaimedExtractionJob, stats: MatchStats): string {
  return [
    'Stats extracted (parser stub)',
    `Message: ${job.externalMessageId}`,
    `Rank: ${stats.rank}`,
    `Kills: ${stats.kills}`,
    `Deaths: ${stats.deaths}`,
    `Урон: ${stats.damage}`,
    `Job: #${job.id}`
  ].join('\n');
}

export function renderProcessingError(job: ClaimedExtractionJob, error: unknown): string {
  return [
    'Image processing failed',
    `Message: ${job.externalMessageId}`,
    `Reason: ${formatError(error)}`,
    `Job: #${job.id}`
  ].join('\n');
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
