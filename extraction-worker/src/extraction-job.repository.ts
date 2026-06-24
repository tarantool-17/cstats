import pg from 'pg';

const { Pool } = pg;

export type ClaimedExtractionJob = {
  id: number;
  imageAssetId: number;
  relativePath: string;
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
            image_assets.relative_path AS "relativePath"
          FROM extraction_jobs
          JOIN image_assets ON image_assets.id = extraction_jobs.image_asset_id
          WHERE extraction_jobs.status = 'queued'
            AND extraction_jobs.available_at <= now()
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
          next_job."relativePath"
      `,
      [workerId]
    );

    return result.rows[0] ?? null;
  }

  async complete(jobId: number): Promise<void> {
    await this.pool.query(
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
  }

  async fail(jobId: number, error: unknown): Promise<void> {
    await this.pool.query(
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
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
