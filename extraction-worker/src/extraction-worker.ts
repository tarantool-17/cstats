import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkerConfig } from './config.js';
import type { ClaimedExtractionJob, ExtractionJobRepository } from './extraction-job.repository.js';
import {
  extractMatchStats,
  renderProcessingError,
  renderStatsNotification,
  type MatchStats
} from './match-stats-extractor.js';

export class ExtractionWorker {
  private running = false;

  constructor(
    private readonly config: WorkerConfig,
    private readonly jobs: ExtractionJobRepository
  ) {}

  async start(): Promise<void> {
    this.running = true;
    console.log(`Extraction worker ${this.config.workerId} started`);

    while (this.running) {
      const worked = await this.workOnce();
      if (!worked) {
        await sleep(this.config.pollIntervalMs);
      }
    }

    console.log(`Extraction worker ${this.config.workerId} stopped`);
  }

  stop(): void {
    this.running = false;
  }

  async workOnce(): Promise<boolean> {
    const job = await this.jobs.claimNext(this.config.workerId);
    if (!job) {
      return false;
    }

    try {
      const stats = await this.process(job);
      await this.jobs.complete(job.id, {
        platform: job.sourcePlatform,
        externalChannelId: job.externalChannelId,
        text: renderStatsNotification(job, stats)
      });
      console.log(`Completed extraction job ${job.id}`);
    } catch (error) {
      await this.jobs.fail(job.id, error, {
        platform: job.sourcePlatform,
        externalChannelId: job.externalChannelId,
        text: renderProcessingError(job, error)
      });
      console.error(`Failed extraction job ${job.id}`, error);
    }

    return true;
  }

  private async process(job: ClaimedExtractionJob): Promise<MatchStats> {
    const imagePath = join(this.config.imageStorageRoot, job.relativePath);
    try {
      await stat(imagePath);
    } catch {
      throw new Error(`Stored image file is missing: ${job.relativePath}`);
    }

    return extractMatchStats(job);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
