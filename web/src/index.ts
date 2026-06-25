import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

type MatchListItem = {
  id: number;
  imageId: number;
  imageWidth: number | null;
  imageHeight: number | null;
  imageMimeType: string | null;
  imageCreatedAt: string;
  mapName: string | null;
  ctScore: number | null;
  tScore: number | null;
  duplicateCount: number;
  screenshotCount: number;
  players: MatchPlayerStat[];
};

type MatchPlayerStat = {
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

type RankPlayerStat = {
  nickname: string;
  matches: number;
  kills: number;
  deaths: number;
  assists: number;
  headshotPercent: number | null;
  damage: number;
};

type ScoreboardTeam = 'CT' | 'T' | 'unknown';

const serverDir = dirname(fileURLToPath(import.meta.url));

const config = {
  clientRoot: resolve(serverDir, '../client'),
  databaseUrl: requireEnv('DATABASE_URL'),
  host: process.env.WEB_HOST ?? '127.0.0.1',
  imageStorageRoot: resolve(process.env.IMAGE_STORAGE_ROOT ?? '/tmp/cstats/images'),
  port: readPositiveInt(process.env.WEB_PORT, 1969)
};

const pool = new Pool({ connectionString: config.databaseUrl });

const server = createServer(async (request, response) => {
  try {
    await routeRequest(request, response);
  } catch (error) {
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
    const [matches, canonicalPlayers] = await Promise.all([
      listUniqueMatches(),
      listCanonicalPlayers()
    ]);

    sendJson(response, 200, { matches, images: matches, canonicalPlayers });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/rank') {
    const [allTime, lastThreeMonths] = await Promise.all([
      listRank(false),
      listRank(true)
    ]);

    sendJson(response, 200, {
      rank: {
        allTime,
        lastThreeMonths
      }
    });
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
    image_created_at: Date;
    map_name: string | null;
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
      image_assets.created_at AS image_created_at,
      match_extractions.map_name,
      match_extractions.ct_score,
      match_extractions.t_score,
      grouped_matches.duplicate_count,
      grouped_matches.screenshot_count
    FROM match_extractions
    JOIN image_assets ON image_assets.id = match_extractions.image_asset_id
    JOIN grouped_matches ON grouped_matches.canonical_match_id = match_extractions.id
    WHERE match_extractions.duplicate_of_match_extraction_id IS NULL
    ORDER BY image_assets.created_at DESC, match_extractions.id DESC
  `);
  const matchIds = result.rows.map((row) => row.id);
  const playersByMatchId = await listTeamPlayers(matchIds);

  return result.rows.map((row) => ({
    id: row.id,
    imageId: row.image_id,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageMimeType: row.image_mime_type,
    imageCreatedAt: row.image_created_at.toISOString(),
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
    const selectedTeam = selectTeamWithKnownPlayers(players);
    const teamPlayers = selectedTeam
      ? players.filter((player) => player.team === selectedTeam)
      : players;

    teamPlayersByMatchId.set(
      matchExtractionId,
      teamPlayers.map(({ rowNumber: _rowNumber, ...player }) => player)
    );
  }

  return teamPlayersByMatchId;
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

async function listRank(recentOnly: boolean): Promise<RankPlayerStat[]> {
  const result = await pool.query<{
    nickname: string;
    matches: string | number;
    kills: string | number;
    deaths: string | number;
    assists: string | number;
    headshot_percent: string | number | null;
    damage: string | number;
  }>(
    `
      WITH known_match_players AS (
        SELECT
          match_extraction_players.match_extraction_id,
          COALESCE(
            resolved_players.display_name,
            known_players.display_name
          ) AS nickname,
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
          AND ($1::boolean = false OR image_assets.created_at >= now() - interval '3 months')
          AND (
            resolved_players.id IS NOT NULL
            OR known_players.display_name IS NOT NULL
          )
      )
      SELECT
        nickname,
        COUNT(DISTINCT match_extraction_id) AS matches,
        SUM(COALESCE(kills, 0)) AS kills,
        SUM(COALESCE(deaths, 0)) AS deaths,
        SUM(COALESCE(assists, 0)) AS assists,
        ROUND(AVG(adr_or_kast) FILTER (WHERE adr_or_kast IS NOT NULL)) AS headshot_percent,
        SUM(COALESCE(damage, 0)) AS damage
      FROM known_match_players
      GROUP BY nickname
      ORDER BY damage DESC, kills DESC, nickname
    `,
    [recentOnly]
  );

  return result.rows.map((row) => ({
    nickname: row.nickname,
    matches: Number(row.matches),
    kills: Number(row.kills),
    deaths: Number(row.deaths),
    assists: Number(row.assists),
    headshotPercent: row.headshot_percent === null ? null : Number(row.headshot_percent),
    damage: Number(row.damage)
  }));
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
