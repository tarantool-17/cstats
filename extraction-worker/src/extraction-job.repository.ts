import pg from 'pg';
import { normalizeNicknameForLookup } from './nickname-normalization.js';
import {
  buildScoreboardFingerprint,
  countMatchingStatRows,
  normalizeMapNameForLookup,
  scoreStatRowSimilarity,
  type ScoreboardFingerprint
} from './scoreboard-idempotency.js';
import type { ScoreboardExtraction, ScoreboardPlayer } from './scoreboard-extraction.js';

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

export type DuplicateMatchType = 'unique' | 'exact_duplicate' | 'strong_fuzzy_duplicate';

export type ScoreboardIdempotencyResult = {
  fingerprint: ScoreboardFingerprint;
  duplicateOfMatchExtractionId: number | null;
  duplicateMatchType: DuplicateMatchType;
  duplicateReason: string | null;
  duplicateMatchScore: number;
  skipStats: boolean;
};

export type ScoreboardPersistenceResult = {
  matchExtractionId: number;
  extraction: ScoreboardExtraction;
  idempotency: ScoreboardIdempotencyResult;
};

type CompletionNotificationFactory = (
  result: ScoreboardPersistenceResult
) => OutboundNotification | undefined;

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

  async complete(
    job: ClaimedExtractionJob,
    extraction: ScoreboardExtraction,
    notificationFactory?: CompletionNotificationFactory
  ): Promise<ScoreboardPersistenceResult> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const persistence = await upsertScoreboardExtraction(client, job.id, extraction);
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
        [job.id]
      );
      await insertOutboundNotification(client, notificationFactory?.(persistence));
      await client.query('COMMIT');
      return persistence;
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

async function upsertScoreboardExtraction(
  client: pg.PoolClient,
  jobId: number,
  extraction: ScoreboardExtraction
): Promise<ScoreboardPersistenceResult> {
  const resolvedExtraction = await resolveScoreboardMapName(client, extraction);
  const existingMatchExtractionId = await findExistingMatchExtractionIdForJob(client, jobId);
  const fingerprint = buildScoreboardFingerprint(resolvedExtraction);
  const idempotency = await classifyScoreboardIdempotency(
    client,
    fingerprint,
    existingMatchExtractionId
  );
  const matchExtractionId = await upsertMatchExtraction(
    client,
    jobId,
    resolvedExtraction,
    idempotency
  );

  await client.query(
    'DELETE FROM match_extraction_players WHERE match_extraction_id = $1',
    [matchExtractionId]
  );

  for (const [index, player] of resolvedExtraction.players.entries()) {
    const extractionPlayerId = await insertMatchExtractionPlayer(
      client,
      matchExtractionId,
      index + 1,
      player
    );
    if (!idempotency.skipStats) {
      await upsertMatchPlayerStat(client, extractionPlayerId, player);
    }
  }

  return {
    matchExtractionId,
    extraction: resolvedExtraction,
    idempotency
  };
}

async function resolveScoreboardMapName(
  client: pg.PoolClient,
  extraction: ScoreboardExtraction
): Promise<ScoreboardExtraction> {
  const candidates = buildMapLookupCandidates(extraction.mapName);
  if (candidates.length === 0) {
    return extraction;
  }

  const result = await client.query<{ displayName: string; fileName: string }>(
    `
      SELECT
        cs2_maps.display_name AS "displayName",
        cs2_maps.file_name AS "fileName"
      FROM cs2_map_aliases
      JOIN cs2_maps ON cs2_maps.id = cs2_map_aliases.map_id
      WHERE cs2_map_aliases.normalized_alias = ANY($1::text[])
        OR $2 LIKE '%' || cs2_map_aliases.normalized_alias
      ORDER BY
        CASE
          WHEN cs2_map_aliases.normalized_alias = $3 THEN 0
          WHEN cs2_map_aliases.normalized_alias = ANY($1::text[]) THEN 1
          ELSE 2
        END,
        length(cs2_map_aliases.normalized_alias) DESC,
        cs2_maps.is_active_duty DESC,
        cs2_maps.display_name
      LIMIT 1
    `,
    [candidates, candidates[0], candidates[0]]
  );

  const match = result.rows[0];
  if (!match) {
    return extraction;
  }

  return {
    ...extraction,
    mapName: match.displayName,
    mapKey: match.fileName
  };
}

function buildMapLookupCandidates(mapName: string | null): string[] {
  const candidates = [
    normalizeMapNameForLookup(mapName),
    normalizeMapNameForLookup(mapName?.split('|').at(-1)?.trim() ?? null)
  ].filter((candidate): candidate is string => candidate !== null);

  return [...new Set(candidates)];
}

async function upsertMatchExtraction(
  client: pg.PoolClient,
  jobId: number,
  extraction: ScoreboardExtraction,
  idempotency: ScoreboardIdempotencyResult
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `
      WITH target_job AS (
        SELECT id, image_asset_id
        FROM extraction_jobs
        WHERE id = $1
      )
      INSERT INTO match_extractions (
        extraction_job_id,
        image_asset_id,
        map_name,
        ct_score,
        t_score,
        confidence,
        warnings,
        fingerprint_version,
        normalized_map_name,
        exact_fingerprint,
        unordered_score_key,
        player_stats_fingerprint,
        duplicate_of_match_extraction_id,
        duplicate_match_type,
        duplicate_reason,
        duplicate_match_score
      )
      SELECT
        target_job.id,
        target_job.image_asset_id,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15
      FROM target_job
      ON CONFLICT (extraction_job_id) DO UPDATE
      SET
        image_asset_id = EXCLUDED.image_asset_id,
        map_name = EXCLUDED.map_name,
        ct_score = EXCLUDED.ct_score,
        t_score = EXCLUDED.t_score,
        confidence = EXCLUDED.confidence,
        warnings = EXCLUDED.warnings,
        fingerprint_version = EXCLUDED.fingerprint_version,
        normalized_map_name = EXCLUDED.normalized_map_name,
        exact_fingerprint = EXCLUDED.exact_fingerprint,
        unordered_score_key = EXCLUDED.unordered_score_key,
        player_stats_fingerprint = EXCLUDED.player_stats_fingerprint,
        duplicate_of_match_extraction_id = EXCLUDED.duplicate_of_match_extraction_id,
        duplicate_match_type = EXCLUDED.duplicate_match_type,
        duplicate_reason = EXCLUDED.duplicate_reason,
        duplicate_match_score = EXCLUDED.duplicate_match_score,
        updated_at = now()
      RETURNING id
    `,
    [
      jobId,
      extraction.mapName,
      extraction.ctScore,
      extraction.tScore,
      extraction.confidence,
      extraction.warnings,
      idempotency.fingerprint.version,
      idempotency.fingerprint.normalizedMapName,
      idempotency.fingerprint.exactFingerprint,
      idempotency.fingerprint.unorderedScoreKey,
      idempotency.fingerprint.playerStatsFingerprint,
      idempotency.duplicateOfMatchExtractionId,
      idempotency.duplicateMatchType,
      idempotency.duplicateReason,
      idempotency.duplicateMatchScore
    ]
  );

  const matchExtractionId = result.rows[0]?.id;
  if (matchExtractionId === undefined) {
    throw new Error(`Extraction job not found while saving scoreboard rows: ${jobId}`);
  }

  return matchExtractionId;
}

async function findExistingMatchExtractionIdForJob(
  client: pg.PoolClient,
  jobId: number
): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    'SELECT id FROM match_extractions WHERE extraction_job_id = $1',
    [jobId]
  );

  return result.rows[0]?.id ?? null;
}

async function classifyScoreboardIdempotency(
  client: pg.PoolClient,
  fingerprint: ScoreboardFingerprint,
  excludeMatchExtractionId: number | null
): Promise<ScoreboardIdempotencyResult> {
  const exactDuplicate = fingerprint.exactFingerprint
    ? await findExactDuplicate(client, fingerprint.exactFingerprint, excludeMatchExtractionId)
    : null;

  if (exactDuplicate) {
    return {
      fingerprint,
      duplicateOfMatchExtractionId: exactDuplicate.id,
      duplicateMatchType: 'exact_duplicate',
      duplicateReason: 'same normalized map, CT/T score, player rank order, and player stat rows',
      duplicateMatchScore: 100,
      skipStats: true
    };
  }

  const strongFuzzyDuplicate = await findStrongFuzzyDuplicate(
    client,
    fingerprint,
    excludeMatchExtractionId
  );

  if (strongFuzzyDuplicate) {
    return {
      fingerprint,
      duplicateOfMatchExtractionId: strongFuzzyDuplicate.id,
      duplicateMatchType: 'strong_fuzzy_duplicate',
      duplicateReason: `same map and score with ${strongFuzzyDuplicate.matchingStatRows} matching player stat rows`,
      duplicateMatchScore: strongFuzzyDuplicate.score,
      skipStats: true
    };
  }

  return {
    fingerprint,
    duplicateOfMatchExtractionId: null,
    duplicateMatchType: 'unique',
    duplicateReason: null,
    duplicateMatchScore: 0,
    skipStats: false
  };
}

async function findExactDuplicate(
  client: pg.PoolClient,
  exactFingerprint: string,
  excludeMatchExtractionId: number | null
): Promise<{ id: number } | null> {
  const result = await client.query<{ id: number }>(
    `
      SELECT id
      FROM match_extractions
      WHERE exact_fingerprint = $1
        AND duplicate_of_match_extraction_id IS NULL
        AND ($2::integer IS NULL OR id <> $2)
      ORDER BY id
      LIMIT 1
    `,
    [exactFingerprint, excludeMatchExtractionId]
  );

  return result.rows[0] ?? null;
}

async function findStrongFuzzyDuplicate(
  client: pg.PoolClient,
  fingerprint: ScoreboardFingerprint,
  excludeMatchExtractionId: number | null
): Promise<{ id: number; matchingStatRows: number; score: number } | null> {
  if (
    !fingerprint.normalizedMapName ||
    !fingerprint.unorderedScoreKey ||
    fingerprint.statRowKeys.length < 8
  ) {
    return null;
  }

  const candidates = await client.query<{
    id: number;
    mapName: string | null;
    mapKey: string | null;
    ctScore: number | null;
    tScore: number | null;
  }>(
    `
      SELECT
        id,
        map_name AS "mapName",
        normalized_map_name AS "mapKey",
        ct_score AS "ctScore",
        t_score AS "tScore"
      FROM match_extractions
      WHERE normalized_map_name = $1
        AND unordered_score_key = $2
        AND duplicate_of_match_extraction_id IS NULL
        AND ($3::integer IS NULL OR id <> $3)
      ORDER BY id
      LIMIT 25
    `,
    [fingerprint.normalizedMapName, fingerprint.unorderedScoreKey, excludeMatchExtractionId]
  );

  if (candidates.rowCount === 0) {
    return null;
  }

  const candidateIds = candidates.rows.map((candidate) => candidate.id);
  const players = await client.query<{
    matchExtractionId: number;
    rowNumber: number;
    team: 'CT' | 'T' | 'unknown';
    rawNickname: string | null;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    adrOrKast: number | null;
    damage: number | null;
  }>(
    `
      SELECT
        match_extraction_id AS "matchExtractionId",
        row_number AS "rowNumber",
        team,
        raw_nickname AS "rawNickname",
        kills,
        deaths,
        assists,
        adr_or_kast AS "adrOrKast",
        damage
      FROM match_extraction_players
      WHERE match_extraction_id = ANY($1::integer[])
      ORDER BY match_extraction_id, row_number
    `,
    [candidateIds]
  );

  let best: { id: number; matchingStatRows: number; score: number } | null = null;

  for (const candidate of candidates.rows) {
    const candidatePlayers = players.rows
      .filter((player) => player.matchExtractionId === candidate.id)
      .sort((first, second) => first.rowNumber - second.rowNumber)
      .map(({ matchExtractionId: _matchExtractionId, rowNumber: _rowNumber, ...player }) => player);
    const candidateFingerprint = buildScoreboardFingerprint({
      mapName: candidate.mapName,
      mapKey: candidate.mapKey,
      ctScore: candidate.ctScore,
      tScore: candidate.tScore,
      confidence: null,
      warnings: [],
      players: candidatePlayers
    });
    const matchingStatRows = countMatchingStatRows(
      fingerprint.statRowKeys,
      candidateFingerprint.statRowKeys
    );

    if (matchingStatRows < 8) {
      continue;
    }

    const score = scoreStatRowSimilarity(
      fingerprint.statRowKeys,
      candidateFingerprint.statRowKeys
    );

    if (!best || matchingStatRows > best.matchingStatRows || score > best.score) {
      best = {
        id: candidate.id,
        matchingStatRows,
        score
      };
    }
  }

  return best;
}

async function insertMatchExtractionPlayer(
  client: pg.PoolClient,
  matchExtractionId: number,
  rowNumber: number,
  player: ScoreboardPlayer
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `
      INSERT INTO match_extraction_players (
        match_extraction_id,
        row_number,
        team,
        raw_nickname,
        kills,
        deaths,
        assists,
        adr_or_kast,
        damage
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      matchExtractionId,
      rowNumber,
      player.team,
      player.rawNickname,
      player.kills,
      player.deaths,
      player.assists,
      player.adrOrKast,
      player.damage
    ]
  );

  return result.rows[0].id;
}

async function upsertMatchPlayerStat(
  client: pg.PoolClient,
  extractionPlayerId: number,
  player: ScoreboardPlayer
): Promise<void> {
  const normalizedNickname = normalizeNicknameForLookup(player.rawNickname);
  const resolvedAlias = normalizedNickname
    ? await findConfirmedAlias(client, normalizedNickname)
    : null;

  await client.query(
    `
      INSERT INTO match_player_stats (
        match_extraction_player_id,
        player_id,
        resolved_alias_id,
        resolution_status,
        raw_nickname,
        normalized_nickname,
        team,
        kills,
        deaths,
        assists,
        adr_or_kast,
        damage
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (match_extraction_player_id) DO UPDATE
      SET
        player_id = EXCLUDED.player_id,
        resolved_alias_id = EXCLUDED.resolved_alias_id,
        resolution_status = EXCLUDED.resolution_status,
        raw_nickname = EXCLUDED.raw_nickname,
        normalized_nickname = EXCLUDED.normalized_nickname,
        team = EXCLUDED.team,
        kills = EXCLUDED.kills,
        deaths = EXCLUDED.deaths,
        assists = EXCLUDED.assists,
        adr_or_kast = EXCLUDED.adr_or_kast,
        damage = EXCLUDED.damage,
        updated_at = now()
    `,
    [
      extractionPlayerId,
      resolvedAlias?.playerId ?? null,
      resolvedAlias?.aliasId ?? null,
      resolvedAlias ? 'resolved' : 'unresolved',
      player.rawNickname,
      normalizedNickname,
      player.team,
      player.kills,
      player.deaths,
      player.assists,
      player.adrOrKast,
      player.damage
    ]
  );
}

async function findConfirmedAlias(
  client: pg.PoolClient,
  normalizedNickname: string
): Promise<{ playerId: number; aliasId: number } | null> {
  const result = await client.query<{ playerId: number; aliasId: number }>(
    `
      SELECT
        player_id AS "playerId",
        id AS "aliasId"
      FROM player_aliases
      WHERE normalized_alias = $1
        AND status = 'confirmed'
      LIMIT 1
    `,
    [normalizedNickname]
  );

  return result.rows[0] ?? null;
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
