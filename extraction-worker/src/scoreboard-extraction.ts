import type { ClaimedExtractionJob, ScoreboardPersistenceResult } from './extraction-job.repository.js';

export type ScoreboardTeam = 'CT' | 'T' | 'unknown';

export type ScoreboardPlayer = {
  team: ScoreboardTeam;
  rawNickname: string | null;
  normalizedNickname?: string | null;
  playerIdentityKey?: string | null;
  playerId?: number | null;
  resolvedAliasId?: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  adrOrKast: number | null;
  damage: number | null;
};

export type ScoreboardExtraction = {
  mapName: string | null;
  mapKey?: string | null;
  ctScore: number | null;
  tScore: number | null;
  players: ScoreboardPlayer[];
  confidence: number | null;
  warnings: string[];
};

export function normalizeScoreboardExtraction(input: unknown): ScoreboardExtraction {
  if (!isRecord(input)) {
    throw new Error('Scoreboard model returned a non-object payload');
  }

  const playersInput = Array.isArray(input.players) ? input.players : [];
  const extraction: ScoreboardExtraction = {
    mapName: readOptionalString(input.mapName),
    ctScore: readOptionalInteger(input.ctScore),
    tScore: readOptionalInteger(input.tScore),
    players: normalizeScoreboardTeams(playersInput.map(normalizePlayer)),
    confidence: readOptionalNumber(input.confidence),
    warnings: readWarnings(input.warnings)
  };

  return {
    ...extraction,
    warnings: [...extraction.warnings, ...validateScoreboard(extraction)]
  };
}

export function extractScoreboardStub(job: ClaimedExtractionJob): ScoreboardExtraction {
  const seed = job.imageAssetId + job.id;

  return {
    mapName: null,
    ctScore: null,
    tScore: null,
    confidence: 0,
    warnings: ['SCOREBOARD_MODEL_URL/SCOREBOARD_MODEL_NAME are not configured; parser stub returned placeholder data'],
    players: [
      {
        team: 'unknown',
        rawNickname: `stub-player-${seed}`,
        kills: (seed * 3) % 31,
        deaths: (seed * 5) % 24,
        assists: seed % 12,
        adrOrKast: null,
        damage: 300 + ((seed * 137) % 2400)
      }
    ]
  };
}

export function renderScoreboardNotification(
  job: ClaimedExtractionJob,
  extraction: ScoreboardExtraction,
  result?: ScoreboardPersistenceResult
): string {
  if (result?.idempotency.skipStats) {
    const header = [
      'Scoreboard already tracked',
      `Message: ${job.externalMessageId}`,
      `Map: ${extraction.mapName ?? 'unknown'}`,
      `Score: CT ${formatValue(extraction.ctScore)} - T ${formatValue(extraction.tScore)}`,
      `Duplicate of extraction: #${formatValue(result.idempotency.duplicateOfMatchExtractionId)}`,
      `Match score: ${result.idempotency.duplicateMatchScore}%`,
      `Reason: ${result.idempotency.duplicateReason ?? result.idempotency.duplicateMatchType}`,
      'Action: saved this extraction as duplicate evidence and skipped stats insert',
      `Job: #${job.id}`
    ];
    const warnings = extraction.warnings.map((warning) => `Warning: ${warning}`);

    return [...header, ...warnings].join('\n');
  }

  return [
    `Map: ${escapeHtml(extraction.mapName ?? 'unknown')}`,
    `Score: CT ${formatValue(extraction.ctScore)} - T ${formatValue(extraction.tScore)}`,
    `<pre>${escapeHtml(renderScoreboardTable(extraction.players))}</pre>`
  ].join('\n');
}

export function renderProcessingError(job: ClaimedExtractionJob, error: unknown): string {
  return [
    'Image processing failed',
    `Message: ${job.externalMessageId}`,
    `Reason: ${formatError(error)}`,
    `Job: #${job.id}`
  ].join('\n');
}

function normalizePlayer(input: unknown): ScoreboardPlayer {
  if (!isRecord(input)) {
    return emptyPlayer();
  }

  return {
    team: normalizeTeam(readOptionalString(input.team)),
    rawNickname: readOptionalString(input.rawNickname),
    kills: readOptionalInteger(input.kills),
    deaths: readOptionalInteger(input.deaths),
    assists: readOptionalInteger(input.assists),
    adrOrKast: readOptionalInteger(input.adrOrKast),
    damage: readOptionalInteger(input.damage)
  };
}

function emptyPlayer(): ScoreboardPlayer {
  return {
    team: 'unknown',
    rawNickname: null,
    kills: null,
    deaths: null,
    assists: null,
    adrOrKast: null,
    damage: null
  };
}

function normalizeScoreboardTeams(players: ScoreboardPlayer[]): ScoreboardPlayer[] {
  if (players.length !== 10) {
    return players;
  }

  return players.map((player, index) => ({
    ...player,
    // The extraction contract requires the upper team first. In the CS2 final scoreboard,
    // those blue rows are CT and the lower yellow rows are T.
    team: index < 5 ? 'CT' : 'T'
  }));
}

function normalizeTeam(value: string | null): ScoreboardTeam {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'CT' || normalized === 'COUNTER-TERRORISTS' || normalized === 'СПЕЦНАЗ') {
    return 'CT';
  }

  if (normalized === 'T' || normalized === 'TERRORISTS' || normalized === 'ТЕРРОРИСТЫ') {
    return 'T';
  }

  return 'unknown';
}

function validateScoreboard(extraction: ScoreboardExtraction): string[] {
  const warnings: string[] = [];

  if (!extraction.mapName) {
    warnings.push('mapName is missing');
  }

  if (extraction.ctScore === null || extraction.tScore === null) {
    warnings.push('team score is incomplete');
  }

  if (extraction.players.length !== 10) {
    warnings.push(`expected 10 players, got ${extraction.players.length}`);
  }

  extraction.players.forEach((player, index) => {
    if (!player.rawNickname) {
      warnings.push(`player ${index + 1} nickname is missing`);
    }

    for (const field of ['kills', 'deaths', 'assists', 'damage'] as const) {
      if (player[field] === null) {
        warnings.push(`player ${index + 1} ${field} is missing`);
      }
    }
  });

  return warnings;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const digits = value.replace(/[^\d-]/g, '');
  if (!digits) {
    return null;
  }

  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readOptionalString)
    .filter((warning): warning is string => warning !== null);
}

function formatConfidence(value: number | null): string {
  if (value === null) {
    return 'unknown';
  }

  return value.toFixed(2);
}

function renderScoreboardTable(players: ScoreboardPlayer[]): string {
  const rows = players.map((player, index) => ({
    number: `${index + 1}.`,
    team: `[${player.team}]`,
    nickname: player.rawNickname ?? 'unknown',
    kills: formatValue(player.kills),
    deaths: formatValue(player.deaths),
    assists: formatValue(player.assists),
    adrOrKast: formatValue(player.adrOrKast),
    damage: formatValue(player.damage)
  }));

  const widths = {
    number: Math.max('#'.length, ...rows.map((row) => row.number.length)),
    team: Math.max('Team'.length, ...rows.map((row) => row.team.length)),
    nickname: Math.max('Nickname'.length, ...rows.map((row) => row.nickname.length)),
    kills: Math.max('Kills'.length, ...rows.map((row) => row.kills.length)),
    deaths: Math.max('Deaths'.length, ...rows.map((row) => row.deaths.length)),
    assists: Math.max('Assists'.length, ...rows.map((row) => row.assists.length)),
    adrOrKast: Math.max('ADR/USP'.length, ...rows.map((row) => row.adrOrKast.length)),
    damage: Math.max('DMG'.length, ...rows.map((row) => row.damage.length))
  };

  const header = [
    '#'.padEnd(widths.number),
    'Team'.padEnd(widths.team),
    'Nickname'.padEnd(widths.nickname),
    'Kills'.padStart(widths.kills),
    'Deaths'.padStart(widths.deaths),
    'Assists'.padStart(widths.assists),
    'ADR/USP'.padStart(widths.adrOrKast),
    'DMG'.padStart(widths.damage)
  ].join(' | ');
  const separator = '-'.repeat(header.length);
  const lines = [header, separator];
  let previousTeam: string | null = null;

  for (const row of rows) {
    if (previousTeam !== null && previousTeam !== row.team) {
      lines.push(separator);
    }

    lines.push([
      row.number.padEnd(widths.number),
      row.team.padEnd(widths.team),
      row.nickname.padEnd(widths.nickname),
      row.kills.padStart(widths.kills),
      row.deaths.padStart(widths.deaths),
      row.assists.padStart(widths.assists),
      row.adrOrKast.padStart(widths.adrOrKast),
      row.damage.padStart(widths.damage)
    ].join(' | '));
    previousTeam = row.team;
  }

  return lines.join('\n');
}

function formatValue(value: number | null): string {
  return value === null ? '?' : String(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
