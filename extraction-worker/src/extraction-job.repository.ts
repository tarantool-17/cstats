import pg from 'pg';

const { Pool } = pg;

export type ClaimedExtractionJob = {
  id: number;
  imageAssetId: number;
  relativePath: string;
  sourcePlatform: 'telegram';
  externalChannelId: string;
  externalMessageId: string;
};

export type OutboundNotification = {
  traceId: string;
  platform: 'telegram';
  externalChannelId: string;
  text: string;
};

export class ExtractionJobRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async claimNext(workerId: string): Promise<ClaimedExtractionJob | null> {
    const result = await this.pool.query<ClaimedExtractionJob>(
      `
        WITH next_job AS (
          SELECT
            extraction_jobs.id,
            extraction_jobs.image_asset_id AS "imageAssetId",
            image_assets.relative_path AS "relativePath",
            source_messages.platform AS "sourcePlatform",
            source_messages.external_channel_id AS "externalChannelId",
            source_messages.external_message_id AS "externalMessageId"
          FROM extraction_jobs
          JOIN image_assets ON image_assets.id = extraction_jobs.image_asset_id
          JOIN source_messages ON source_messages.id = image_assets.source_message_id
          WHERE (
            extraction_jobs.status = 'queued'
            AND extraction_jobs.available_at <= now()
          ) OR (
            extraction_jobs.status = 'processing'
            AND extraction_jobs.locked_at < now() - interval '5 minutes'
          )
          ORDER BY extraction_jobs.available_at, extraction_jobs.id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE extraction_jobs
        SET
          status = 'processing',
          attempt_count = attempt_count + 1,
          locked_at = now(),
          locked_by = $1,
          last_error = NULL,
          updated_at = now()
        FROM next_job
        WHERE extraction_jobs.id = next_job.id
        RETURNING
          extraction_jobs.id,
          extraction_jobs.image_asset_id AS "imageAssetId",
          next_job."relativePath",
          next_job."sourcePlatform",
          next_job."externalChannelId",
          next_job."externalMessageId"
      `,
      [workerId]
    );

    return result.rows[0] ?? null;
  }

  async complete(jobId: number, notification?: OutboundNotification): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `
          UPDATE extraction_jobs
          SET
            status = 'completed',
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
          WHERE id = $1
        `,
        [jobId]
      );
      await insertOutboundNotification(client, notification);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(jobId: number, error: unknown, notification?: OutboundNotification): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `
          UPDATE extraction_jobs
          SET
            status = 'failed',
            locked_at = NULL,
            locked_by = NULL,
            last_error = $2,
            updated_at = now()
          WHERE id = $1
        `,
        [jobId, formatError(error)]
      );
      await insertOutboundNotification(client, notification);
      await client.query('COMMIT');
    } catch (updateError) {
      await client.query('ROLLBACK');
      throw updateError;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

async function insertOutboundNotification(
  client: pg.PoolClient,
  notification: OutboundNotification | undefined
): Promise<void> {
  if (!notification) {
    return;
  }

  await client.query(
    `
      INSERT INTO outbound_messages (trace_id, platform, external_channel_id, text)
      VALUES ($1, $2, $3, $4)
    `,
    [notification.traceId, notification.platform, notification.externalChannelId, notification.text]
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
