import pg from 'pg';

const { Pool } = pg;

export type ClaimedOutboundMessage = {
  id: number;
  platform: 'telegram';
  externalChannelId: string;
  text: string;
};

export type OutboundMessageRepository = {
  claimNext(dispatcherId: string): Promise<ClaimedOutboundMessage | null>;
  markSent(messageId: number): Promise<void>;
  markFailed(messageId: number, error: unknown): Promise<void>;
};

export class PostgresOutboundMessageRepository implements OutboundMessageRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async claimNext(dispatcherId: string): Promise<ClaimedOutboundMessage | null> {
    const result = await this.pool.query<ClaimedOutboundMessage>(
      `
        WITH next_message AS (
          SELECT
            id,
            platform,
            external_channel_id AS "externalChannelId",
            text
          FROM outbound_messages
          WHERE (
            status = 'queued'
            AND available_at <= now()
          ) OR (
            status = 'sending'
            AND locked_at < now() - interval '5 minutes'
          )
          ORDER BY available_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE outbound_messages
        SET
          status = 'sending',
          attempt_count = attempt_count + 1,
          locked_at = now(),
          locked_by = $1,
          last_error = NULL,
          updated_at = now()
        FROM next_message
        WHERE outbound_messages.id = next_message.id
        RETURNING
          outbound_messages.id,
          next_message.platform,
          next_message."externalChannelId",
          next_message.text
      `,
      [dispatcherId]
    );

    return result.rows[0] ?? null;
  }

  async markSent(messageId: number): Promise<void> {
    await this.pool.query(
      `
        UPDATE outbound_messages
        SET
          status = 'sent',
          locked_at = NULL,
          locked_by = NULL,
          sent_at = now(),
          updated_at = now()
        WHERE id = $1
      `,
      [messageId]
    );
  }

  async markFailed(messageId: number, error: unknown): Promise<void> {
    await this.pool.query(
      `
        UPDATE outbound_messages
        SET
          status = 'failed',
          locked_at = NULL,
          locked_by = NULL,
          last_error = $2,
          updated_at = now()
        WHERE id = $1
      `,
      [messageId, formatError(error)]
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
