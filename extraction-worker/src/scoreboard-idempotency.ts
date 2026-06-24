import { createHash } from 'node:crypto';
import { normalizeNicknameForLookup } from './nickname-normalization.js';
import type { ScoreboardExtraction, ScoreboardPlayer } from './scoreboard-extraction.js';

export const SCOREBOARD_FINGERPRINT_VERSION = 1;

export type ScoreboardFingerprint = {
  version: number;
  normalizedMapName: string | null;
  exactScoreKey: string | null;
  unorderedScoreKey: string | null;
  exactFingerprint: string | null;
  playerStatsFingerprint: string | null;
  orderedRows: FingerprintPlayerRow[];
  statRowKeys: string[];
};

export type FingerprintPlayerRow = {
  rowNumber: number;
  team: string;
  normalizedNickname: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  adrOrKast: number | null;
  damage: number | null;
  rankKey: string;
  statKey: string | null;
};

const MIN_RECOGNIZED_STAT_ROWS_FOR_FINGERPRINT = 8;

export function buildScoreboardFingerprint(extraction: ScoreboardExtraction): ScoreboardFingerprint {
  const normalizedMapName = normalizeMapName(extraction.mapKey ?? extraction.mapName);
  const exactScoreKey = buildExactScoreKey(extraction);
  const unorderedScoreKey = buildUnorderedScoreKey(extraction);
  const orderedRows = extraction.players.map((player, index) => buildPlayerRow(player, index + 1));
  const statRowKeys = orderedRows
    .map((row) => row.statKey)
    .filter((key): key is string => key !== null)
    .sort();

  const hasEnoughStatRows = statRowKeys.length >= MIN_RECOGNIZED_STAT_ROWS_FOR_FINGERPRINT;
  const exactFingerprint =
    normalizedMapName && exactScoreKey && hasEnoughStatRows
      ? hashFingerprint({
          version: SCOREBOARD_FINGERPRINT_VERSION,
          map: normalizedMapName,
          score: exactScoreKey,
          rows: orderedRows.map((row) => row.rankKey)
        })
      : null;
  const playerStatsFingerprint =
    normalizedMapName && unorderedScoreKey && hasEnoughStatRows
      ? hashFingerprint({
          version: SCOREBOARD_FINGERPRINT_VERSION,
          map: normalizedMapName,
          score: unorderedScoreKey,
          rows: statRowKeys
        })
      : null;

  return {
    version: SCOREBOARD_FINGERPRINT_VERSION,
    normalizedMapName,
    exactScoreKey,
    unorderedScoreKey,
    exactFingerprint,
    playerStatsFingerprint,
    orderedRows,
    statRowKeys
  };
}

export function countMatchingStatRows(first: string[], second: string[]): number {
  const remaining = new Map<string, number>();

  for (const key of second) {
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  let matches = 0;
  for (const key of first) {
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      matches += 1;
      remaining.set(key, count - 1);
    }
  }

  return matches;
}

export function scoreStatRowSimilarity(first: string[], second: string[]): number {
  const denominator = Math.max(first.length, second.length);
  if (denominator === 0) {
    return 0;
  }

  return Math.round((countMatchingStatRows(first, second) / denominator) * 100);
}

export function normalizeMapNameForLookup(mapName: string | null): string | null {
  if (!mapName) {
    return null;
  }

  const withoutHeader = mapName.split('|').at(-1)?.trim() ?? mapName;
  const normalized = withoutHeader
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  return normalized.length > 0 ? normalized : null;
}

function buildPlayerRow(player: ScoreboardPlayer, rowNumber: number): FingerprintPlayerRow {
  const normalizedNickname = normalizeNicknameForLookup(player.rawNickname);
  const statValues = [
    valueKey(player.kills),
    valueKey(player.deaths),
    valueKey(player.assists),
    valueKey(player.adrOrKast),
    valueKey(player.damage)
  ];
  const statKey =
    normalizedNickname && player.kills !== null && player.deaths !== null
      ? [normalizedNickname, ...statValues].join('|')
      : null;

  return {
    rowNumber,
    team: player.team,
    normalizedNickname,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    adrOrKast: player.adrOrKast,
    damage: player.damage,
    rankKey: [
      rowNumber,
      player.team,
      normalizedNickname ?? '?',
      ...statValues
    ].join('|'),
    statKey
  };
}

function normalizeMapName(mapName: string | null): string | null {
  const trimmed = mapName?.trim().toLowerCase() ?? null;
  if (trimmed && /^(de|cs|ar)_[a-z0-9_]+$/.test(trimmed)) {
    return trimmed;
  }

  const normalized = normalizeMapNameForLookup(mapName);

  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('de') && normalized.length > 2) {
    return `de_${normalized.slice(2)}`;
  }

  if (normalized.startsWith('cs') && normalized.length > 2) {
    return `cs_${normalized.slice(2)}`;
  }

  if (normalized.startsWith('ar') && normalized.length > 2) {
    return `ar_${normalized.slice(2)}`;
  }

  return normalized;
}

function buildExactScoreKey(extraction: ScoreboardExtraction): string | null {
  if (extraction.ctScore === null || extraction.tScore === null) {
    return null;
  }

  return `ct:${extraction.ctScore}|t:${extraction.tScore}`;
}

function buildUnorderedScoreKey(extraction: ScoreboardExtraction): string | null {
  if (extraction.ctScore === null || extraction.tScore === null) {
    return null;
  }

  const low = Math.min(extraction.ctScore, extraction.tScore);
  const high = Math.max(extraction.ctScore, extraction.tScore);
  return `${low}:${high}`;
}

function valueKey(value: number | null): string {
  return value === null ? '?' : String(value);
}

function hashFingerprint(payload: unknown): string {
  return `scoreboard:v${SCOREBOARD_FINGERPRINT_VERSION}:${createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')}`;
}
