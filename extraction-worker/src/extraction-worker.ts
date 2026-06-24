import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkerConfig } from './config.js';
import { DockerModelRunnerScoreboardClient } from './docker-model-runner-scoreboard-client.js';
import type { ClaimedExtractionJob, ExtractionJobRepository } from './extraction-job.repository.js';
import { logError, logInfo } from './logger.js';
import {
  extractScoreboardStub,
  renderProcessingError,
  renderScoreboardNotification,
  type ScoreboardExtraction
} from './scoreboard-extraction.js';

export class ExtractionWorker {
  private running = false;
  private readonly scoreboardClient?: DockerModelRunnerScoreboardClient;

  constructor(
    private readonly config: WorkerConfig,
    private readonly jobs: ExtractionJobRepository
  ) {
    this.scoreboardClient = config.scoreboardModel
      ? new DockerModelRunnerScoreboardClient(config.scoreboardModel)
      : undefined;
  }

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
      const extraction = await this.process(job);
      await this.jobs.complete(job.id, {
        traceId: job.externalMessageId,
        platform: job.sourcePlatform,
        externalChannelId: job.externalChannelId,
        text: renderScoreboardNotification(job, extraction)
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

  private async process(job: ClaimedExtractionJob): Promise<ScoreboardExtraction> {
    const imagePath = join(this.config.imageStorageRoot, job.relativePath);
    try {
      await stat(imagePath);
    } catch {
      throw new Error(`Stored image file is missing: ${job.relativePath}`);
    }

    return this.scoreboardClient
      ? this.scoreboardClient.extract(imagePath)
      : extractScoreboardStub(job);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
