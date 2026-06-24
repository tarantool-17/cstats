import { createHash } from 'node:crypto';
import { normalizeNicknameForLookup } from './nickname-normalization.js';
import type { ScoreboardExtraction, ScoreboardPlayer } from './scoreboard-extraction.js';

export const SCOREBOARD_FINGERPRINT_VERSION = 1;

export type ScoreboardFingerprint = {
  version: number;
  normalizedMapName: string | null;
  ctScore: number | null;
  tScore: number | null;
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
  teamPosition: number;
  normalizedNickname: string | null;
  playerIdentityKey: string | null;
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
  const orderedRows = buildPlayerRows(extraction.players);
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
    ctScore: extraction.ctScore,
    tScore: extraction.tScore,
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

export function countAlmostMatchingPositionRows(
  first: FingerprintPlayerRow[],
  second: FingerprintPlayerRow[]
): number {
  const remaining = [...second];
  let matches = 0;

  for (const row of first) {
    const index = remaining.findIndex((candidate) => rowsAreAlmostSame(row, candidate));
    if (index >= 0) {
      matches += 1;
      remaining.splice(index, 1);
    }
  }

  return matches;
}

export function scorePositionRowSimilarity(
  first: FingerprintPlayerRow[],
  second: FingerprintPlayerRow[]
): number {
  const firstComparable = first.filter(isComparablePositionRow).length;
  const secondComparable = second.filter(isComparablePositionRow).length;
  const denominator = Math.max(firstComparable, secondComparable);

  if (denominator === 0) {
    return 0;
  }

  return Math.round((countAlmostMatchingPositionRows(first, second) / denominator) * 100);
}

export function getScoreDistance(
  first: ScoreboardFingerprint,
  second: ScoreboardFingerprint
): number | null {
  if (
    first.ctScore === null ||
    first.tScore === null ||
    second.ctScore === null ||
    second.tScore === null
  ) {
    return null;
  }

  const exactDistance =
    Math.abs(first.ctScore - second.ctScore) + Math.abs(first.tScore - second.tScore);
  const firstSorted = [first.ctScore, first.tScore].sort((a, b) => a - b);
  const secondSorted = [second.ctScore, second.tScore].sort((a, b) => a - b);
  const unorderedDistance =
    Math.abs(firstSorted[0] - secondSorted[0]) + Math.abs(firstSorted[1] - secondSorted[1]);

  return Math.min(exactDistance, unorderedDistance);
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

function buildPlayerRows(players: ScoreboardPlayer[]): FingerprintPlayerRow[] {
  const teamPositions = new Map<string, number>();

  return players.map((player, index) => {
    const currentPosition = (teamPositions.get(player.team) ?? 0) + 1;
    teamPositions.set(player.team, currentPosition);

    return buildPlayerRow(player, index + 1, currentPosition);
  });
}

function buildPlayerRow(
  player: ScoreboardPlayer,
  rowNumber: number,
  teamPosition: number
): FingerprintPlayerRow {
  const normalizedNickname =
    player.normalizedNickname ?? normalizeNicknameForLookup(player.rawNickname);
  const playerIdentityKey =
    player.playerIdentityKey ??
    (player.playerId ? `player:${player.playerId}` : normalizedNickname ? `nick:${normalizedNickname}` : null);
  const statValues = [
    valueKey(player.kills),
    valueKey(player.deaths),
    valueKey(player.assists),
    valueKey(player.adrOrKast),
    valueKey(player.damage)
  ];
  const statKey =
    playerIdentityKey && player.kills !== null && player.deaths !== null
      ? [player.team, teamPosition, playerIdentityKey, ...statValues].join('|')
      : null;

  return {
    rowNumber,
    team: player.team,
    teamPosition,
    normalizedNickname,
    playerIdentityKey,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    adrOrKast: player.adrOrKast,
    damage: player.damage,
    rankKey: [
      player.team,
      teamPosition,
      playerIdentityKey ?? '?',
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

function rowsAreAlmostSame(first: FingerprintPlayerRow, second: FingerprintPlayerRow): boolean {
  if (!isComparablePositionRow(first) || !isComparablePositionRow(second)) {
    return false;
  }

  if (first.team !== second.team || first.teamPosition !== second.teamPosition) {
    return false;
  }

  if (!playerIdentitiesAreAlmostSame(first, second)) {
    return false;
  }

  return scoreRowStats(first, second) >= 70;
}

function isComparablePositionRow(row: FingerprintPlayerRow): boolean {
  return row.playerIdentityKey !== null && row.team !== 'unknown' && row.teamPosition > 0;
}

function playerIdentitiesAreAlmostSame(
  first: FingerprintPlayerRow,
  second: FingerprintPlayerRow
): boolean {
  if (first.playerIdentityKey === second.playerIdentityKey) {
    return true;
  }

  if (
    first.playerIdentityKey?.startsWith('player:') ||
    second.playerIdentityKey?.startsWith('player:')
  ) {
    return false;
  }

  return nicknamesAreAlmostSame(first.normalizedNickname, second.normalizedNickname);
}

function nicknamesAreAlmostSame(first: string | null, second: string | null): boolean {
  if (!first || !second) {
    return false;
  }

  if (first === second) {
    return true;
  }

  const maxDistance = Math.max(first.length, second.length) >= 6 ? 2 : 1;
  return levenshteinDistance(first, second, maxDistance) <= maxDistance;
}

function levenshteinDistance(first: string, second: string, maxDistance: number): number {
  if (Math.abs(first.length - second.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex];
    let rowMinimum = current[0];

    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost = first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
      const value = Math.min(
        previous[secondIndex] + 1,
        current[secondIndex - 1] + 1,
        previous[secondIndex - 1] + substitutionCost
      );
      current[secondIndex] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[second.length];
}

function scoreRowStats(first: FingerprintPlayerRow, second: FingerprintPlayerRow): number {
  const scores = [
    scoreSmallStat(first.kills, second.kills),
    scoreSmallStat(first.deaths, second.deaths),
    scoreSmallStat(first.assists, second.assists),
    scoreSmallStat(first.adrOrKast, second.adrOrKast),
    scoreDamage(first.damage, second.damage)
  ].filter((score): score is number => score !== null);

  if (scores.length < 3) {
    return 0;
  }

  const total = scores.reduce((sum, score) => sum + score, 0);
  return Math.round((total / scores.length) * 100);
}

function scoreSmallStat(first: number | null, second: number | null): number | null {
  if (first === null || second === null) {
    return null;
  }

  const diff = Math.abs(first - second);
  if (diff === 0) {
    return 1;
  }

  if (diff === 1) {
    return 0.75;
  }

  if (diff === 2) {
    return 0.5;
  }

  return 0;
}

function scoreDamage(first: number | null, second: number | null): number | null {
  if (first === null || second === null) {
    return null;
  }

  const diff = Math.abs(first - second);
  if (diff === 0) {
    return 1;
  }

  if (diff <= 100) {
    return 0.75;
  }

  if (diff <= 250) {
    return 0.5;
  }

  return 0;
}

function hashFingerprint(payload: unknown): string {
  return `scoreboard:v${SCOREBOARD_FINGERPRINT_VERSION}:${createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')}`;
}
