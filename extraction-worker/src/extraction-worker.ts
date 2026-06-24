import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkerConfig } from './config.js';
import type { ClaimedExtractionJob, ExtractionJobRepository } from './extraction-job.repository.js';
import { logError, logInfo } from './logger.js';
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

    const logFields = {
      trace_id: job.externalMessageId,
      extraction_job_id: job.id,
      image_asset_id: job.imageAssetId
    };
    logInfo('extractor_in_process', logFields);

    try {
      const stats = await this.process(job);
      await this.jobs.complete(job.id, {
        traceId: job.externalMessageId,
        platform: job.sourcePlatform,
        externalChannelId: job.externalChannelId,
        text: renderStatsNotification(job, stats)
      });
      logInfo('telegram_outbound_ready', { ...logFields, status: 'completed' });
    } catch (error) {
      await this.jobs.fail(job.id, error, {
        traceId: job.externalMessageId,
        platform: job.sourcePlatform,
        externalChannelId: job.externalChannelId,
        text: renderProcessingError(job, error)
      });
      logError('telegram_outbound_ready', { ...logFields, status: 'failed' }, error);
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
