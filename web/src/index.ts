import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import pg from 'pg';

const { Pool } = pg;

type MatchListItem = {
  id: number;
  imageId: number;
  imageWidth: number | null;
  imageHeight: number | null;
  imageMimeType: string | null;
  playedAt: string;
  mapKey: string | null;
  mapName: string | null;
  ctScore: number | null;
  tScore: number | null;
  duplicateCount: number;
  screenshotCount: number;
  players: MatchPlayerStat[];
};

type MatchPlayerStat = {
  id: number;
  nickname: string;
  rawNickname: string | null;
  canonicalPlayerId: number | null;
  canonicalNickname: string | null;
  team: ScoreboardTeam;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  headshotPercent: number | null;
  damage: number | null;
};

type CanonicalPlayer = {
  id: number;
  displayName: string;
};

type CanonicalMap = {
  mapKey: string;
  displayName: string;
};

type RankPlayerStat = {
  canonicalPlayerId: number | null;
  nickname: string;
  steamAvatarUrl: string | null;
  steamProfileUrl: string | null;
  matches: number;
  kills: number;
  deaths: number;
  assists: number;
  headshotPercent: number | null;
  damage: number;
};

type RankMapStat = {
  mapName: string;
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  damage: number;
};

type RankPeriod = {
  players: RankPlayerStat[];
  maps: RankMapStat[];
};

type ScoreboardTeam = 'CT' | 'T' | 'unknown';

const POSTGRES_INTEGER_MAX = 2147483647;

type SaveMatchPlayerInput = {
  id: number;
  canonicalPlayerId: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  headshotPercent: number | null;
  damage: number | null;
};

type SaveMatchRequest = {
  ctScore: number | null | undefined;
  mapKey: string | null | undefined;
  playedAt: Date | null | undefined;
  players: SaveMatchPlayerInput[];
  tScore: number | null | undefined;
};

const serverDir = dirname(fileURLToPath(import.meta.url));

const config = {
  clientRoot: resolve(serverDir, '../client'),
  databaseUrl: requireEnv('DATABASE_URL'),
  host: process.env.WEB_HOST ?? '127.0.0.1',
  imageStorageRoot: resolve(process.env.IMAGE_STORAGE_ROOT ?? '/tmp/cstats/images'),
  port: readPositiveInt(process.env.WEB_PORT, 1969),
  rankSessionDayStartHour: readIntegerInRange(process.env.RANK_SESSION_DAY_START_HOUR, 12, 0, 23),
  rankSessionTimeZone: process.env.RANK_SESSION_TIME_ZONE ?? 'Europe/Warsaw'
};

const pool = new Pool({ connectionString: config.databaseUrl });

const server = createServer(async (request, response) => {
  try {
    await routeRequest(request, response);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }

    console.error(JSON.stringify({ level: 'error', step: 'web_request_failed', error: formatError(error) }));
    sendJson(response, 500, { error: 'Internal server error' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    level: 'info',
    step: 'web_service_started',
    host: config.host,
    port: config.port,
    image_storage_root: config.imageStorageRoot
  }));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    console.log(`${signal} received, stopping web service`);
    server.close();
    await pool.end();
  });
}

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && (url.pathname === '/api/matches' || url.pathname === '/api/images')) {
    const [matches, canonicalPlayers, maps] = await Promise.all([
      listUniqueMatches(),
      listCanonicalPlayers(),
      listCanonicalMaps()
    ]);

    sendJson(response, 200, { matches, images: matches, canonicalPlayers, maps });
    return;
  }

  const matchPlayersRoute = url.pathname.match(/^\/api\/matches\/(\d+)\/players$/);
  if (request.method === 'PUT' && matchPlayersRoute) {
    const matchExtractionId = Number.parseInt(matchPlayersRoute[1], 10);
    if (!Number.isSafeInteger(matchExtractionId) || matchExtractionId <= 0) {
      throw new HttpError(400, 'Invalid match id');
    }

    const body = await readJsonBody(request);
    const saveRequest = parseSaveMatchRequest(body);
    const savedMatch = await saveMatch(matchExtractionId, saveRequest);
    const rank = await listRankData();

    sendJson(response, 200, {
      ...savedMatch,
      rank
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/rank') {
    const rank = await listRankData();

    sendJson(response, 200, { rank });
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/images/')) {
    await sendImage(request, response, url.pathname);
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    await sendStaticAsset(request, response, url.pathname);
    return;
  }

  sendText(response, 404, 'Not found');
}

async function listUniqueMatches(): Promise<MatchListItem[]> {
  const result = await pool.query<{
    id: number;
    image_id: number;
    image_width: number | null;
    image_height: number | null;
    image_mime_type: string | null;
    played_at: Date;
    map_name: string | null;
    map_key: string | null;
    ct_score: number | null;
    t_score: number | null;
    duplicate_count: string | number;
    screenshot_count: string | number;
  }>(`
    WITH grouped_matches AS (
      SELECT
        COALESCE(duplicate_of_match_extraction_id, id) AS canonical_match_id,
        COUNT(*) AS screenshot_count,
        COUNT(*) FILTER (WHERE duplicate_of_match_extraction_id IS NOT NULL) AS duplicate_count
      FROM match_extractions
      GROUP BY COALESCE(duplicate_of_match_extraction_id, id)
    )
    SELECT
      match_extractions.id,
      image_assets.id AS image_id,
      image_assets.width AS image_width,
      image_assets.height AS image_height,
      image_assets.mime_type AS image_mime_type,
      COALESCE(match_extractions.played_at, image_assets.created_at) AS played_at,
      cs2_maps.map_key,
      match_extractions.map_name,
      match_extractions.ct_score,
      match_extractions.t_score,
      grouped_matches.duplicate_count,
      grouped_matches.screenshot_count
    FROM match_extractions
    JOIN image_assets ON image_assets.id = match_extractions.image_asset_id
    JOIN grouped_matches ON grouped_matches.canonical_match_id = match_extractions.id
    LEFT JOIN cs2_maps ON cs2_maps.display_name = match_extractions.map_name
    WHERE match_extractions.duplicate_of_match_extraction_id IS NULL
    ORDER BY COALESCE(match_extractions.played_at, image_assets.created_at) DESC, match_extractions.id DESC
  `);
  const matchIds = result.rows.map((row) => row.id);
  const playersByMatchId = await listTeamPlayers(matchIds);

  return result.rows.map((row) => ({
    id: row.id,
    imageId: row.image_id,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageMimeType: row.image_mime_type,
    playedAt: row.played_at.toISOString(),
    mapKey: row.map_key,
    mapName: row.map_name,
    ctScore: row.ct_score,
    tScore: row.t_score,
    duplicateCount: Number(row.duplicate_count),
    screenshotCount: Number(row.screenshot_count),
    players: playersByMatchId.get(row.id) ?? []
  }));
}

async function listTeamPlayers(matchExtractionIds: number[]): Promise<Map<number, MatchPlayerStat[]>> {
  if (matchExtractionIds.length === 0) {
    return new Map();
  }

  const result = await pool.query<{
    match_extraction_id: number;
    match_extraction_player_id: number;
    row_number: number;
    team: ScoreboardTeam;
    raw_nickname: string | null;
    canonical_player_id: number | null;
    canonical_nickname: string | null;
    nickname: string;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    adr_or_kast: number | null;
    damage: number | null;
  }>(
    `
      SELECT
        match_extraction_players.match_extraction_id,
        match_extraction_players.id AS match_extraction_player_id,
        match_extraction_players.row_number,
        match_extraction_players.team,
        match_extraction_players.raw_nickname,
        COALESCE(match_player_stats.player_id, known_players.id) AS canonical_player_id,
        COALESCE(resolved_players.display_name, known_players.display_name) AS canonical_nickname,
        COALESCE(resolved_players.display_name, known_players.display_name, match_extraction_players.raw_nickname, 'unknown') AS nickname,
        match_extraction_players.kills,
        match_extraction_players.deaths,
        match_extraction_players.assists,
        match_extraction_players.adr_or_kast,
        match_extraction_players.damage
      FROM match_extraction_players
      LEFT JOIN match_player_stats
        ON match_player_stats.match_extraction_player_id = match_extraction_players.id
      LEFT JOIN players AS resolved_players
        ON resolved_players.id = match_player_stats.player_id
      LEFT JOIN LATERAL (
        SELECT players.id, players.display_name
        FROM players
        LEFT JOIN player_aliases
          ON player_aliases.player_id = players.id
        WHERE lower(regexp_replace(btrim(players.display_name), '\\s+', ' ', 'g')) =
            lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
          OR (
            player_aliases.status IN ('confirmed', 'suggested')
            AND player_aliases.normalized_alias =
              lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
          )
        ORDER BY
          CASE
            WHEN lower(regexp_replace(btrim(players.display_name), '\\s+', ' ', 'g')) =
              lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
              THEN 0
            WHEN player_aliases.status = 'confirmed' THEN 1
            ELSE 2
          END,
          players.display_name
        LIMIT 1
      ) AS known_players ON true
      WHERE match_extraction_players.match_extraction_id = ANY($1::integer[])
      ORDER BY match_extraction_players.match_extraction_id, match_extraction_players.row_number
    `,
    [matchExtractionIds]
  );

  const extractedPlayersByMatchId = new Map<number, Array<MatchPlayerStat & { rowNumber: number }>>();
  for (const row of result.rows) {
    const players = extractedPlayersByMatchId.get(row.match_extraction_id) ?? [];
    players.push({
      id: row.match_extraction_player_id,
      nickname: row.nickname,
      rawNickname: row.raw_nickname,
      canonicalPlayerId: row.canonical_player_id,
      canonicalNickname: row.canonical_nickname,
      team: row.team,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      headshotPercent: row.adr_or_kast,
      damage: row.damage,
      rowNumber: row.row_number
    });
    extractedPlayersByMatchId.set(row.match_extraction_id, players);
  }

  const teamPlayersByMatchId = new Map<number, MatchPlayerStat[]>();
  for (const [matchExtractionId, players] of extractedPlayersByMatchId) {
    const playersWithEffectiveTeams = normalizeScoreboardTeams(players);
    const selectedTeam = selectTeamWithKnownPlayers(playersWithEffectiveTeams);
    const teamPlayers = selectedTeam
      ? playersWithEffectiveTeams.filter((player) => player.team === selectedTeam)
      : playersWithEffectiveTeams;

    teamPlayersByMatchId.set(
      matchExtractionId,
      teamPlayers.map(({ rowNumber: _rowNumber, ...player }) => player)
    );
  }

  return teamPlayersByMatchId;
}

function normalizeScoreboardTeams(
  players: Array<MatchPlayerStat & { rowNumber: number }>
): Array<MatchPlayerStat & { rowNumber: number }> {
  const hasStandardScoreboardLayout = players.length === 10
    && players.every((player, index) => player.rowNumber === index + 1);

  if (!hasStandardScoreboardLayout) {
    return players;
  }

  return players.map((player) => ({
    ...player,
    // CS2's final scoreboard lists the blue CT roster first and the yellow T roster second.
    // This protects results from an OCR model swapping the side labels.
    team: player.rowNumber <= 5 ? 'CT' : 'T'
  }));
}

function selectTeamWithKnownPlayers(
  players: Array<MatchPlayerStat & { rowNumber: number }>
): ScoreboardTeam | undefined {
  const summaries = new Map<ScoreboardTeam, { knownCount: number; rowCount: number; firstRowNumber: number }>();

  for (const player of players) {
    const summary = summaries.get(player.team) ?? {
      knownCount: 0,
      rowCount: 0,
      firstRowNumber: player.rowNumber
    };

    summary.knownCount += player.canonicalPlayerId === null ? 0 : 1;
    summary.rowCount += 1;
    summary.firstRowNumber = Math.min(summary.firstRowNumber, player.rowNumber);
    summaries.set(player.team, summary);
  }

  return [...summaries.entries()].sort((first, second) => (
    second[1].knownCount - first[1].knownCount
    || second[1].rowCount - first[1].rowCount
    || first[1].firstRowNumber - second[1].firstRowNumber
  ))[0]?.[0];
}

async function listCanonicalPlayers(): Promise<CanonicalPlayer[]> {
  const result = await pool.query<{ id: number; display_name: string }>(`
    SELECT id, display_name
    FROM players
    ORDER BY lower(display_name), display_name
  `);

  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name
  }));
}

async function listCanonicalMaps(): Promise<CanonicalMap[]> {
  const result = await pool.query<{ map_key: string; display_name: string }>(`
    SELECT map_key, display_name
    FROM cs2_maps
    WHERE is_current_pool = true
    ORDER BY is_active_duty DESC, lower(display_name), display_name
  `);

  return result.rows.map((row) => ({
    mapKey: row.map_key,
    displayName: row.display_name
  }));
}

async function listRankData(): Promise<{
  allTime: RankPeriod;
  lastThreeMonths: RankPeriod;
  lastMeta: RankPeriod;
}> {
  const [
    allTimePlayers,
    allTimeMaps,
    lastThreeMonthsPlayers,
    lastThreeMonthsMaps,
    lastMetaPlayers,
    lastMetaMaps
  ] = await Promise.all([
    listPlayerRank(null),
    listMapRank(null),
    listPlayerRank(3),
    listMapRank(3),
    listPlayerRank(null, true),
    listMapRank(null, true)
  ]);

  return {
    allTime: {
      players: allTimePlayers,
      maps: allTimeMaps
    },
    lastThreeMonths: {
      players: lastThreeMonthsPlayers,
      maps: lastThreeMonthsMaps
    },
    lastMeta: {
      players: lastMetaPlayers,
      maps: lastMetaMaps
    }
  };
}

async function listPlayerRank(months: number | null, latestSessionOnly = false): Promise<RankPlayerStat[]> {
  const result = await pool.query<{
    canonical_player_id: number | null;
    nickname: string;
    steam_avatar_url: string | null;
    steam_profile_url: string | null;
    matches: string | number;
    kills: string | number;
    deaths: string | number;
    assists: string | number;
    headshot_percent: string | number | null;
    damage: string | number;
  }>(
    `
      WITH latest_rank_session AS (
        SELECT
          (
            (
              MAX(COALESCE(match_extractions.played_at, image_assets.created_at)) AT TIME ZONE $2
            ) - ($3::integer * interval '1 hour')
          )::date AS session_day
        FROM match_extractions
        JOIN image_assets
          ON image_assets.id = match_extractions.image_asset_id
        WHERE match_extractions.duplicate_of_match_extraction_id IS NULL
      ),
      known_match_players AS (
        SELECT
          match_extraction_players.match_extraction_id,
          COALESCE(
            resolved_players.id,
            known_players.id
          ) AS player_id,
          COALESCE(
            resolved_players.display_name,
            known_players.display_name
          ) AS nickname,
          COALESCE(
            resolved_players.steam_avatar_url,
            known_players.steam_avatar_url
          ) AS steam_avatar_url,
          COALESCE(
            resolved_players.steam_profile_url,
            known_players.steam_profile_url
          ) AS steam_profile_url,
          match_extraction_players.kills,
          match_extraction_players.deaths,
          match_extraction_players.assists,
          match_extraction_players.adr_or_kast,
          match_extraction_players.damage
        FROM match_extraction_players
        JOIN match_extractions
          ON match_extractions.id = match_extraction_players.match_extraction_id
        JOIN image_assets
          ON image_assets.id = match_extractions.image_asset_id
        LEFT JOIN match_player_stats
          ON match_player_stats.match_extraction_player_id = match_extraction_players.id
        LEFT JOIN players AS resolved_players
          ON resolved_players.id = match_player_stats.player_id
        LEFT JOIN LATERAL (
          SELECT
            players.id,
            players.display_name,
            players.steam_avatar_url,
            players.steam_profile_url
          FROM players
          LEFT JOIN player_aliases
            ON player_aliases.player_id = players.id
          WHERE lower(regexp_replace(btrim(players.display_name), '\\s+', ' ', 'g')) =
              lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
            OR (
              player_aliases.status IN ('confirmed', 'suggested')
              AND player_aliases.normalized_alias =
                lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
            )
          ORDER BY
            CASE
              WHEN lower(regexp_replace(btrim(players.display_name), '\\s+', ' ', 'g')) =
                lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
                THEN 0
              WHEN player_aliases.status = 'confirmed' THEN 1
              ELSE 2
            END,
            players.display_name
          LIMIT 1
        ) AS known_players ON true
        WHERE match_extractions.duplicate_of_match_extraction_id IS NULL
          AND (
            $1::integer IS NULL
            OR COALESCE(match_extractions.played_at, image_assets.created_at) >= now() - ($1::integer * interval '1 month')
          )
          AND (
            $4::boolean = false
            OR (
              (
                COALESCE(match_extractions.played_at, image_assets.created_at) AT TIME ZONE $2
              ) - ($3::integer * interval '1 hour')
            )::date = (SELECT session_day FROM latest_rank_session)
          )
          AND (
            resolved_players.id IS NOT NULL
            OR known_players.display_name IS NOT NULL
          )
      )
      SELECT
        player_id AS canonical_player_id,
        nickname,
        steam_avatar_url,
        steam_profile_url,
        COUNT(DISTINCT match_extraction_id) AS matches,
        SUM(COALESCE(kills, 0)) AS kills,
        SUM(COALESCE(deaths, 0)) AS deaths,
        SUM(COALESCE(assists, 0)) AS assists,
        ROUND(AVG(adr_or_kast) FILTER (WHERE adr_or_kast IS NOT NULL)) AS headshot_percent,
        SUM(COALESCE(damage, 0)) AS damage
      FROM known_match_players
      GROUP BY player_id, nickname, steam_avatar_url, steam_profile_url
      ORDER BY damage DESC, kills DESC, nickname
    `,
    [months, config.rankSessionTimeZone, config.rankSessionDayStartHour, latestSessionOnly]
  );

  return result.rows.map((row) => ({
    canonicalPlayerId: row.canonical_player_id,
    nickname: row.nickname,
    steamAvatarUrl: row.steam_avatar_url,
    steamProfileUrl: row.steam_profile_url,
    matches: Number(row.matches),
    kills: Number(row.kills),
    deaths: Number(row.deaths),
    assists: Number(row.assists),
    headshotPercent: row.headshot_percent === null ? null : Number(row.headshot_percent),
    damage: Number(row.damage)
  }));
}

async function listMapRank(months: number | null, latestSessionOnly = false): Promise<RankMapStat[]> {
  const result = await pool.query<{
    map_name: string | null;
    matches: string | number;
    wins: string | number;
    losses: string | number;
    kills: string | number;
    deaths: string | number;
    damage: string | number;
  }>(
    `
      WITH latest_rank_session AS (
        SELECT
          (
            (
              MAX(COALESCE(match_extractions.played_at, image_assets.created_at)) AT TIME ZONE $2
            ) - ($3::integer * interval '1 hour')
          )::date AS session_day
        FROM match_extractions
        JOIN image_assets
          ON image_assets.id = match_extractions.image_asset_id
        WHERE match_extractions.duplicate_of_match_extraction_id IS NULL
      ),
      raw_match_player_rows AS (
        SELECT
          match_extractions.id AS match_extraction_id,
          COALESCE(match_extractions.map_name, 'Unknown map') AS map_name,
          match_extractions.ct_score,
          match_extractions.t_score,
          match_extraction_players.team AS extracted_team,
          match_extraction_players.row_number,
          match_extraction_players.kills,
          match_extraction_players.deaths,
          match_extraction_players.damage,
          CASE
            WHEN resolved_players.id IS NOT NULL OR known_players.display_name IS NOT NULL THEN 1
            ELSE 0
          END AS known_count,
          COUNT(*) OVER (
            PARTITION BY match_extraction_players.match_extraction_id
          ) AS extracted_player_count,
          MIN(match_extraction_players.row_number) OVER (
            PARTITION BY match_extraction_players.match_extraction_id
          ) AS first_row_number,
          MAX(match_extraction_players.row_number) OVER (
            PARTITION BY match_extraction_players.match_extraction_id
          ) AS last_row_number
        FROM match_extraction_players
        JOIN match_extractions
          ON match_extractions.id = match_extraction_players.match_extraction_id
        JOIN image_assets
          ON image_assets.id = match_extractions.image_asset_id
        LEFT JOIN match_player_stats
          ON match_player_stats.match_extraction_player_id = match_extraction_players.id
        LEFT JOIN players AS resolved_players
          ON resolved_players.id = match_player_stats.player_id
        LEFT JOIN LATERAL (
          SELECT players.display_name
          FROM players
          LEFT JOIN player_aliases
            ON player_aliases.player_id = players.id
          WHERE lower(regexp_replace(btrim(players.display_name), '\\s+', ' ', 'g')) =
              lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
            OR (
              player_aliases.status IN ('confirmed', 'suggested')
              AND player_aliases.normalized_alias =
                lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
            )
          ORDER BY
            CASE
              WHEN lower(regexp_replace(btrim(players.display_name), '\\s+', ' ', 'g')) =
                lower(regexp_replace(btrim(coalesce(match_extraction_players.raw_nickname, '')), '\\s+', ' ', 'g'))
                THEN 0
              WHEN player_aliases.status = 'confirmed' THEN 1
              ELSE 2
            END,
            players.display_name
          LIMIT 1
        ) AS known_players ON true
        WHERE match_extractions.duplicate_of_match_extraction_id IS NULL
          AND (
            $1::integer IS NULL
            OR COALESCE(match_extractions.played_at, image_assets.created_at) >= now() - ($1::integer * interval '1 month')
          )
          AND (
            $4::boolean = false
            OR (
              (
                COALESCE(match_extractions.played_at, image_assets.created_at) AT TIME ZONE $2
              ) - ($3::integer * interval '1 hour')
            )::date = (SELECT session_day FROM latest_rank_session)
          )
      ),
      match_player_rows AS (
        SELECT
          match_extraction_id,
          map_name,
          ct_score,
          t_score,
          CASE
            WHEN extracted_player_count = 10
              AND first_row_number = 1
              AND last_row_number = 10
              THEN CASE WHEN row_number <= 5 THEN 'CT' ELSE 'T' END
            ELSE extracted_team
          END AS team,
          row_number,
          kills,
          deaths,
          damage,
          known_count
        FROM raw_match_player_rows
      ),
      selected_teams AS (
        SELECT DISTINCT ON (match_extraction_id)
          match_extraction_id,
          team
        FROM (
          SELECT
            match_extraction_id,
            team,
            SUM(known_count) AS known_player_count,
            COUNT(*) AS row_count,
            MIN(row_number) AS first_row_number
          FROM match_player_rows
          GROUP BY match_extraction_id, team
        ) AS team_summaries
        ORDER BY
          match_extraction_id,
          known_player_count DESC,
          row_count DESC,
          first_row_number
      ),
      selected_match_rows AS (
        SELECT match_player_rows.*
        FROM match_player_rows
        JOIN selected_teams
          ON selected_teams.match_extraction_id = match_player_rows.match_extraction_id
          AND selected_teams.team = match_player_rows.team
        WHERE match_player_rows.team IN ('CT', 'T')
      ),
      match_map_stats AS (
        SELECT
          match_extraction_id,
          map_name,
          team,
          MAX(ct_score) AS ct_score,
          MAX(t_score) AS t_score,
          SUM(COALESCE(kills, 0)) AS kills,
          SUM(COALESCE(deaths, 0)) AS deaths,
          SUM(COALESCE(damage, 0)) AS damage
        FROM selected_match_rows
        GROUP BY match_extraction_id, map_name, team
      )
      SELECT
        map_name,
        COUNT(*) AS matches,
        COUNT(*) FILTER (
          WHERE (
            team = 'CT'
            AND ct_score IS NOT NULL
            AND t_score IS NOT NULL
            AND ct_score > t_score
          ) OR (
            team = 'T'
            AND ct_score IS NOT NULL
            AND t_score IS NOT NULL
            AND t_score > ct_score
          )
        ) AS wins,
        COUNT(*) FILTER (
          WHERE (
            team = 'CT'
            AND ct_score IS NOT NULL
            AND t_score IS NOT NULL
            AND ct_score < t_score
          ) OR (
            team = 'T'
            AND ct_score IS NOT NULL
            AND t_score IS NOT NULL
            AND t_score < ct_score
          )
        ) AS losses,
        SUM(kills) AS kills,
        SUM(deaths) AS deaths,
        SUM(damage) AS damage
      FROM match_map_stats
      GROUP BY map_name
      ORDER BY damage DESC, wins DESC, map_name
    `,
    [months, config.rankSessionTimeZone, config.rankSessionDayStartHour, latestSessionOnly]
  );

  return result.rows.map((row) => ({
    mapName: row.map_name ?? 'Unknown map',
    matches: Number(row.matches),
    wins: Number(row.wins),
    losses: Number(row.losses),
    kills: Number(row.kills),
    deaths: Number(row.deaths),
    damage: Number(row.damage)
  }));
}

async function saveMatch(
  matchExtractionId: number,
  request: SaveMatchRequest
): Promise<{
  ctScore: number | null;
  mapKey: string | null;
  mapName: string | null;
  playedAt: string;
  players: MatchPlayerStat[];
  tScore: number | null;
}> {
  const client = await pool.connect();
  let savedMap: { mapKey: string | null; mapName: string | null };
  let savedPlayedAt: Date;
  let savedScore: { ctScore: number | null; tScore: number | null };

  try {
    await client.query('BEGIN');

    const matchResult = await client.query<{ id: number }>(
      `
        SELECT id
        FROM match_extractions
        WHERE id = $1
          AND duplicate_of_match_extraction_id IS NULL
        FOR UPDATE
      `,
      [matchExtractionId]
    );
    if (matchResult.rowCount === 0) {
      throw new HttpError(404, 'Match not found');
    }

    const currentMatch = await findMatchMetadata(client, matchExtractionId);
    savedMap = request.mapKey === undefined
      ? currentMatch
      : await updateMatchMap(client, matchExtractionId, request.mapKey);
    savedPlayedAt = request.playedAt === undefined
      ? currentMatch.playedAt
      : await updateMatchPlayedAt(client, matchExtractionId, request.playedAt, currentMatch.imageCreatedAt);
    savedScore = request.ctScore === undefined && request.tScore === undefined
      ? currentMatch
      : await updateMatchScore(
        client,
        matchExtractionId,
        request.ctScore === undefined ? currentMatch.ctScore : request.ctScore,
        request.tScore === undefined ? currentMatch.tScore : request.tScore
      );

    if (request.players.length > 0) {
      await saveMatchPlayerRows(client, matchExtractionId, request.players);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    ...savedScore!,
    ...savedMap!,
    playedAt: savedPlayedAt!.toISOString(),
    players: (await listTeamPlayers([matchExtractionId])).get(matchExtractionId) ?? []
  };
}

async function updateMatchScore(
  client: pg.PoolClient,
  matchExtractionId: number,
  ctScore: number | null,
  tScore: number | null
): Promise<{ ctScore: number | null; tScore: number | null }> {
  const result = await client.query<{ ct_score: number | null; t_score: number | null }>(
    `
      UPDATE match_extractions
      SET
        ct_score = $2,
        t_score = $3,
        updated_at = now()
      WHERE id = $1
      RETURNING ct_score, t_score
    `,
    [matchExtractionId, ctScore, tScore]
  );

  return {
    ctScore: result.rows[0]?.ct_score ?? null,
    tScore: result.rows[0]?.t_score ?? null
  };
}

async function updateMatchPlayedAt(
  client: pg.PoolClient,
  matchExtractionId: number,
  playedAt: Date | null,
  fallbackPlayedAt: Date
): Promise<Date> {
  const result = await client.query<{ played_at: Date | null }>(
    `
      UPDATE match_extractions
      SET
        played_at = $2,
        updated_at = now()
      WHERE id = $1
      RETURNING played_at
    `,
    [matchExtractionId, playedAt]
  );

  return result.rows[0]?.played_at ?? fallbackPlayedAt;
}

async function updateMatchMap(
  client: pg.PoolClient,
  matchExtractionId: number,
  mapKey: string | null
): Promise<{ mapKey: string | null; mapName: string | null }> {
  if (mapKey === null) {
    await client.query(
      `
        UPDATE match_extractions
        SET
          map_name = NULL,
          updated_at = now()
        WHERE id = $1
      `,
      [matchExtractionId]
    );

    return { mapKey: null, mapName: null };
  }

  const mapResult = await client.query<{ map_key: string; display_name: string }>(
    `
      SELECT map_key, display_name
      FROM cs2_maps
      WHERE map_key = $1
        AND is_current_pool = true
      LIMIT 1
    `,
    [mapKey]
  );
  const map = mapResult.rows[0];
  if (!map) {
    throw new HttpError(400, 'Selected map does not exist');
  }

  await client.query(
    `
      UPDATE match_extractions
      SET
        map_name = $2,
        updated_at = now()
      WHERE id = $1
    `,
    [matchExtractionId, map.display_name]
  );

  return { mapKey: map.map_key, mapName: map.display_name };
}

async function findMatchMetadata(
  client: pg.PoolClient,
  matchExtractionId: number
): Promise<{
  ctScore: number | null;
  mapKey: string | null;
  mapName: string | null;
  playedAt: Date;
  imageCreatedAt: Date;
  tScore: number | null;
}> {
  const result = await client.query<{
    ct_score: number | null;
    map_key: string | null;
    map_name: string | null;
    played_at: Date | null;
    image_created_at: Date;
    t_score: number | null;
  }>(
    `
      SELECT
        match_extractions.ct_score,
        cs2_maps.map_key,
        match_extractions.map_name,
        match_extractions.played_at,
        image_assets.created_at AS image_created_at,
        match_extractions.t_score
      FROM match_extractions
      JOIN image_assets ON image_assets.id = match_extractions.image_asset_id
      LEFT JOIN cs2_maps ON cs2_maps.display_name = match_extractions.map_name
      WHERE match_extractions.id = $1
      LIMIT 1
    `,
    [matchExtractionId]
  );
  const match = result.rows[0];

  return {
    ctScore: match?.ct_score ?? null,
    mapKey: match?.map_key ?? null,
    mapName: match?.map_name ?? null,
    playedAt: match?.played_at ?? match?.image_created_at ?? new Date(0),
    imageCreatedAt: match?.image_created_at ?? new Date(0),
    tScore: match?.t_score ?? null
  };
}

async function saveMatchPlayerRows(
  client: pg.PoolClient,
  matchExtractionId: number,
  players: SaveMatchPlayerInput[]
): Promise<void> {
  const ids = players.map((player) => player.id);
  const existingPlayers = await client.query<{
    id: number;
    raw_nickname: string | null;
    team: ScoreboardTeam;
  }>(
    `
      SELECT id, raw_nickname, team
      FROM match_extraction_players
      WHERE match_extraction_id = $1
        AND id = ANY($2::integer[])
      FOR UPDATE
    `,
    [matchExtractionId, ids]
  );

  if (existingPlayers.rowCount !== ids.length) {
    throw new HttpError(400, 'One or more players do not belong to this match');
  }

  const existingPlayersById = new Map(existingPlayers.rows.map((player) => [player.id, player]));
  const canonicalPlayerIds = [
    ...new Set(
      players
        .map((player) => player.canonicalPlayerId)
        .filter((playerId): playerId is number => playerId !== null)
    )
  ];
  const canonicalPlayers = await findCanonicalPlayers(client, canonicalPlayerIds);

  if (canonicalPlayers.size !== canonicalPlayerIds.length) {
    throw new HttpError(400, 'One or more canonical players do not exist');
  }

  for (const player of players) {
    const existingPlayer = existingPlayersById.get(player.id);
    if (!existingPlayer) {
      throw new HttpError(400, 'One or more players do not belong to this match');
    }

    const normalizedNickname = normalizeNicknameForLookup(existingPlayer.raw_nickname);
    let resolvedAliasId: number | null = null;

    if (player.canonicalPlayerId !== null) {
      if (!normalizedNickname || !existingPlayer.raw_nickname) {
        throw new HttpError(400, 'Cannot attach a canonical player without an extracted nickname');
      }

      resolvedAliasId = await saveConfirmedAliasForPlayer(
        client,
        player.canonicalPlayerId,
        existingPlayer.raw_nickname,
        normalizedNickname
      );
    }

    await client.query(
      `
        UPDATE match_extraction_players
        SET
          kills = $2,
          deaths = $3,
          assists = $4,
          adr_or_kast = $5,
          damage = $6,
          updated_at = now()
        WHERE id = $1
      `,
      [
        player.id,
        player.kills,
        player.deaths,
        player.assists,
        player.headshotPercent,
        player.damage
      ]
    );

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
        player.id,
        player.canonicalPlayerId,
        resolvedAliasId,
        player.canonicalPlayerId === null ? 'unresolved' : 'resolved',
        existingPlayer.raw_nickname,
        normalizedNickname,
        existingPlayer.team,
        player.kills,
        player.deaths,
        player.assists,
        player.headshotPercent,
        player.damage
      ]
    );
  }
}

async function findCanonicalPlayers(
  client: pg.PoolClient,
  playerIds: number[]
): Promise<Map<number, string>> {
  if (playerIds.length === 0) {
    return new Map();
  }

  const result = await client.query<{ id: number; display_name: string }>(
    `
      SELECT id, display_name
      FROM players
      WHERE id = ANY($1::integer[])
    `,
    [playerIds]
  );

  return new Map(result.rows.map((player) => [player.id, player.display_name]));
}

async function saveConfirmedAliasForPlayer(
  client: pg.PoolClient,
  playerId: number,
  aliasText: string,
  normalizedAlias: string
): Promise<number> {
  const existingAlias = await client.query<{
    id: number;
    player_id: number;
    display_name: string;
  }>(
    `
      SELECT
        player_aliases.id,
        player_aliases.player_id,
        players.display_name
      FROM player_aliases
      JOIN players ON players.id = player_aliases.player_id
      WHERE player_aliases.normalized_alias = $1
        AND player_aliases.status = 'confirmed'
      LIMIT 1
    `,
    [normalizedAlias]
  );
  const existingConfirmedAlias = existingAlias.rows[0];

  if (existingConfirmedAlias) {
    if (existingConfirmedAlias.player_id !== playerId) {
      throw new HttpError(
        409,
        `Alias "${aliasText}" is already confirmed for ${existingConfirmedAlias.display_name}`
      );
    }

    return existingConfirmedAlias.id;
  }

  const savedAlias = await client.query<{ id: number }>(
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
      RETURNING id
    `,
    [playerId, aliasText, normalizedAlias]
  );

  return savedAlias.rows[0].id;
}

async function sendImage(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<void> {
  const imageId = Number.parseInt(pathname.slice('/images/'.length), 10);
  if (!Number.isSafeInteger(imageId) || imageId <= 0) {
    sendText(response, 400, 'Invalid image id');
    return;
  }

  const image = await findImage(imageId);
  if (!image) {
    sendText(response, 404, 'Image not found');
    return;
  }

  const absolutePath = resolve(config.imageStorageRoot, image.relativePath);
  if (!isPathInside(config.imageStorageRoot, absolutePath)) {
    sendText(response, 404, 'Image not found');
    return;
  }

  try {
    await access(absolutePath);
  } catch {
    sendText(response, 404, 'Image file not found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'private, max-age=60',
    'Content-Type': image.mimeType ?? contentTypeForPath(absolutePath)
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(absolutePath).pipe(response);
}

async function findImage(id: number): Promise<{ relativePath: string; mimeType: string | null } | undefined> {
  const result = await pool.query<{ relative_path: string; mime_type: string | null }>(
    `
      SELECT relative_path, mime_type
      FROM image_assets
      WHERE id = $1
    `,
    [id]
  );

  return result.rows[0]
    ? { relativePath: result.rows[0].relative_path, mimeType: result.rows[0].mime_type }
    : undefined;
}

async function sendStaticAsset(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<void> {
  const safePathname = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const absolutePath = resolve(config.clientRoot, `.${safePathname}`);
  if (!isPathInside(config.clientRoot, absolutePath)) {
    sendText(response, 404, 'Not found');
    return;
  }

  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }
  } catch {
    sendText(response, 404, 'Not found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': safePathname === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    'Content-Type': contentTypeForPath(absolutePath)
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(absolutePath).pipe(response);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > 1024 * 1024) {
      throw new HttpError(413, 'Request body is too large');
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new HttpError(400, 'Missing JSON body');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function parseSaveMatchRequest(body: unknown): SaveMatchRequest {
  if (!isRecord(body) || !Array.isArray(body.players)) {
    throw new HttpError(400, 'Expected a players array');
  }

  const seenIds = new Set<number>();
  const mapKey = Object.hasOwn(body, 'mapKey')
    ? readNullableString(body.mapKey, 'mapKey')
    : undefined;
  const playedAt = Object.hasOwn(body, 'playedAt')
    ? readNullableDate(body.playedAt, 'playedAt')
    : undefined;
  const ctScore = Object.hasOwn(body, 'ctScore')
    ? readNullableNonNegativeInteger(body.ctScore, 'ctScore')
    : undefined;
  const tScore = Object.hasOwn(body, 'tScore')
    ? readNullableNonNegativeInteger(body.tScore, 'tScore')
    : undefined;

  return {
    ctScore,
    mapKey,
    playedAt,
    players: body.players.map((player, index) => {
      if (!isRecord(player)) {
        throw new HttpError(400, `players[${index}] must be an object`);
      }

      const id = readPositiveInteger(player.id, `players[${index}].id`);
      if (seenIds.has(id)) {
        throw new HttpError(400, `players[${index}].id is duplicated`);
      }
      seenIds.add(id);

      return {
        id,
        canonicalPlayerId: readNullablePositiveInteger(
          player.canonicalPlayerId,
          `players[${index}].canonicalPlayerId`
        ),
        kills: readNullableNonNegativeInteger(player.kills, `players[${index}].kills`),
        deaths: readNullableNonNegativeInteger(player.deaths, `players[${index}].deaths`),
        assists: readNullableNonNegativeInteger(player.assists, `players[${index}].assists`),
        headshotPercent: readNullableNonNegativeInteger(
          player.headshotPercent,
          `players[${index}].headshotPercent`
        ),
        damage: readNullableNonNegativeInteger(player.damage, `players[${index}].damage`)
      };
    }),
    tScore
  };
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string or null`);
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readNullableDate(value: unknown, field: string): Date | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be an ISO date-time string or null`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${field} must be a valid date-time`);
  }

  return parsed;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > POSTGRES_INTEGER_MAX
  ) {
    throw new HttpError(400, `${field} must be a positive integer`);
  }

  return value;
}

function readNullablePositiveInteger(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }

  return readPositiveInteger(value, field);
}

function readNullableNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }

  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > POSTGRES_INTEGER_MAX
  ) {
    throw new HttpError(400, `${field} must be a non-negative integer or null`);
  }

  return value;
}

function normalizeNicknameForLookup(nickname: string | null): string | null {
  if (nickname === null) {
    return null;
  }

  const normalized = nickname.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.gif':
      return 'image/gif';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readIntegerInRange(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
