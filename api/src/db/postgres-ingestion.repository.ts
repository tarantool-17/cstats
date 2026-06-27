import pg from 'pg';
import type { NormalizedMessage } from '../channels/normalized-message.js';
import type { IngestedImage } from '../ingestion/ingestion.service.js';
import type {
  DatabaseImageIngestion,
  DatabaseIngestionResult,
  IngestionRepository
} from '../ingestion/ingestion.repository.js';

const { Pool } = pg;

export class PostgresIngestionRepository implements IngestionRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async recordImageMessage(
    message: NormalizedMessage,
    images: IngestedImage[]
  ): Promise<DatabaseIngestionResult> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const source = await upsertSourceMessage(client, message);
      const dbImages: DatabaseImageIngestion[] = [];

      for (const image of images) {
        const asset = await upsertImageAsset(client, source.id, image);
        const jobId = asset.inserted ? await createExtractionJob(client, asset.id) : undefined;

        dbImages.push({
          imageAssetId: asset.id,
          imageAssetInserted: asset.inserted,
          extractionJobId: jobId
        });
      }

      await client.query('COMMIT');

      return {
        sourceMessageId: source.id,
        sourceMessageInserted: source.inserted,
        images: dbImages
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

async function upsertSourceMessage(
  client: pg.PoolClient,
  message: NormalizedMessage
): Promise<{ id: number; inserted: boolean }> {
  const inserted = await client.query<{ id: number }>(
    `
      INSERT INTO source_messages (
        platform,
        external_channel_id,
        external_message_id,
        external_sender_id,
        sender_username,
        sender_display_name,
        message_text,
        received_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (platform, external_channel_id, external_message_id) DO NOTHING
      RETURNING id
    `,
    [
      message.platform,
      message.externalChannelId,
      message.externalMessageId,
      message.externalSenderId,
      message.senderUsername,
      message.senderDisplayName,
      message.messageText,
      message.receivedAt
    ]
  );

  if (inserted.rowCount === 1) {
    return { id: inserted.rows[0].id, inserted: true };
  }

  const existing = await client.query<{ id: number }>(
    `
      SELECT id
      FROM source_messages
      WHERE platform = $1
        AND external_channel_id = $2
        AND external_message_id = $3
    `,
    [message.platform, message.externalChannelId, message.externalMessageId]
  );

  return { id: existing.rows[0].id, inserted: false };
}

async function upsertImageAsset(
  client: pg.PoolClient,
  sourceMessageId: number,
  image: IngestedImage
): Promise<{ id: number; inserted: boolean }> {
  const inserted = await client.query<{ id: number }>(
    `
      INSERT INTO image_assets (
        source_message_id,
        relative_path,
        sha256,
        width,
        height,
        mime_type,
        source_file_name,
        telegram_file_path,
        captured_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (sha256) DO NOTHING
      RETURNING id
    `,
    [
      sourceMessageId,
      image.storage.relativePath,
      image.sha256,
      image.attachment.width,
      image.attachment.height,
      image.attachment.mimeType,
      image.sourceFileName,
      image.telegramFilePath,
      image.capturedAt
    ]
  );

  if (inserted.rowCount === 1) {
    return { id: inserted.rows[0].id, inserted: true };
  }

  const existing = await client.query<{ id: number }>(
    'SELECT id FROM image_assets WHERE sha256 = $1',
    [image.sha256]
  );

  return { id: existing.rows[0].id, inserted: false };
}

async function createExtractionJob(client: pg.PoolClient, imageAssetId: number): Promise<number> {
  const result = await client.query<{ id: number }>(
    `
      INSERT INTO extraction_jobs (image_asset_id)
      VALUES ($1)
      ON CONFLICT (image_asset_id) DO UPDATE
        SET updated_at = extraction_jobs.updated_at
      RETURNING id
    `,
    [imageAssetId]
  );

  return result.rows[0].id;
}
