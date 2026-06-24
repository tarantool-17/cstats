import pg from 'pg';
import { normalizeNicknameForLookup } from './nickname-normalization.js';

const { Pool } = pg;

export type SavePlayerAliasResult =
  | {
      status: 'saved' | 'already_exists';
      aliasText: string;
      targetAliasText: string;
      playerId: number;
      playerDisplayName: string;
    }
  | {
      status: 'target_not_found';
      targetAliasText: string;
    }
  | {
      status: 'alias_conflict';
      aliasText: string;
      existingPlayerDisplayName: string;
    };

export type CreatePlayerResult =
  | {
      status: 'created';
      playerId: number;
      playerDisplayName: string;
      primaryAliasText: string;
    }
  | {
      status: 'alias_conflict';
      primaryAliasText: string;
      existingPlayerDisplayName: string;
    };

export interface PlayerAliasRepository {
  createPlayer(displayName: string, primaryAliasText: string): Promise<CreatePlayerResult>;
  saveConfirmedAlias(aliasText: string, targetAliasText: string): Promise<SavePlayerAliasResult>;
}

export class PostgresPlayerAliasRepository implements PlayerAliasRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async createPlayer(displayName: string, primaryAliasText: string): Promise<CreatePlayerResult> {
    const normalizedPrimaryAlias = normalizeNicknameForLookup(primaryAliasText);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const existingAlias = await findConfirmedAlias(client, normalizedPrimaryAlias);
      if (existingAlias) {
        await client.query('ROLLBACK');
        return {
          status: 'alias_conflict',
          primaryAliasText,
          existingPlayerDisplayName: existingAlias.playerDisplayName
        };
      }

      const player = await client.query<{ id: number; displayName: string }>(
        `
          INSERT INTO players (display_name)
          VALUES ($1)
          RETURNING
            id,
            display_name AS "displayName"
        `,
        [displayName]
      );
      const createdPlayer = player.rows[0];

      await client.query(
        `
          INSERT INTO player_aliases (
            player_id,
            alias_text,
            normalized_alias,
            status
          )
          VALUES ($1, $2, $3, 'confirmed')
        `,
        [createdPlayer.id, primaryAliasText, normalizedPrimaryAlias]
      );

      await client.query('COMMIT');

      return {
        status: 'created',
        playerId: createdPlayer.id,
        playerDisplayName: createdPlayer.displayName,
        primaryAliasText
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveConfirmedAlias(aliasText: string, targetAliasText: string): Promise<SavePlayerAliasResult> {
    const normalizedAlias = normalizeNicknameForLookup(aliasText);
    const normalizedTargetAlias = normalizeNicknameForLookup(targetAliasText);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const target = await findConfirmedAlias(client, normalizedTargetAlias);
      if (!target) {
        await client.query('ROLLBACK');
        return { status: 'target_not_found', targetAliasText };
      }

      const existingAlias = await findConfirmedAlias(client, normalizedAlias);
      if (existingAlias) {
        await client.query('ROLLBACK');

        if (existingAlias.playerId === target.playerId) {
          return {
            status: 'already_exists',
            aliasText,
            targetAliasText,
            playerId: target.playerId,
            playerDisplayName: target.playerDisplayName
          };
        }

        return {
          status: 'alias_conflict',
          aliasText,
          existingPlayerDisplayName: existingAlias.playerDisplayName
        };
      }

      await client.query(
        `
          INSERT INTO player_aliases (
            player_id,
            alias_text,
            normalized_alias,
            status
          )
          VALUES ($1, $2, $3, 'confirmed')
          ON CONFLICT (player_id, normalized_alias) DO UPDATE
          SET
            alias_text = EXCLUDED.alias_text,
            status = 'confirmed',
            updated_at = now()
        `,
        [target.playerId, aliasText, normalizedAlias]
      );

      await client.query('COMMIT');

      return {
        status: 'saved',
        aliasText,
        targetAliasText,
        playerId: target.playerId,
        playerDisplayName: target.playerDisplayName
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

type ConfirmedAliasRow = {
  aliasId: number;
  playerId: number;
  playerDisplayName: string;
};

async function findConfirmedAlias(
  client: pg.PoolClient,
  normalizedAlias: string
): Promise<ConfirmedAliasRow | null> {
  const result = await client.query<ConfirmedAliasRow>(
    `
      SELECT
        player_aliases.id AS "aliasId",
        players.id AS "playerId",
        players.display_name AS "playerDisplayName"
      FROM player_aliases
      JOIN players ON players.id = player_aliases.player_id
      WHERE player_aliases.normalized_alias = $1
        AND player_aliases.status = 'confirmed'
      LIMIT 1
    `,
    [normalizedAlias]
  );

  return result.rows[0] ?? null;
}
