import type { ClaimedExtractionJob } from './extraction-job.repository.js';

export type ScoreboardTeam = 'CT' | 'T' | 'unknown';

export type ScoreboardPlayer = {
  team: ScoreboardTeam;
  rawNickname: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  adrOrKast: number | null;
  damage: number | null;
};

export type ScoreboardExtraction = {
  mapName: string | null;
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
    players: playersInput.map(normalizePlayer),
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

export function renderScoreboardNotification(job: ClaimedExtractionJob, extraction: ScoreboardExtraction): string {
  const header = [
    extraction.warnings.length > 0 ? 'Scoreboard extracted with warnings' : 'Scoreboard extracted',
    `Message: ${job.externalMessageId}`,
    `Map: ${extraction.mapName ?? 'unknown'}`,
    `Score: CT ${formatValue(extraction.ctScore)} - T ${formatValue(extraction.tScore)}`,
    `Confidence: ${formatConfidence(extraction.confidence)}`,
    `Job: #${job.id}`
  ];

  const warnings = extraction.warnings.map((warning) => `Warning: ${warning}`);
  const players = extraction.players.map((player, index) => {
    return [
      `${index + 1}. [${player.team}] ${player.rawNickname ?? 'unknown'}`,
      `K/D/A ${formatValue(player.kills)}/${formatValue(player.deaths)}/${formatValue(player.assists)}`,
      `ADR/USP ${formatValue(player.adrOrKast)}`,
      `DMG ${formatValue(player.damage)}`
    ].join(' | ');
  });

  return [...header, ...warnings, ...players].join('\n');
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

function formatValue(value: number | null): string {
  return value === null ? '?' : String(value);
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
