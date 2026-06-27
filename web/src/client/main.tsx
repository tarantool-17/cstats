import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

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
  players: PlayerStat[];
};

type PlayerStat = {
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

type RankPeriodData = {
  players: RankPlayerStat[];
  maps: RankMapStat[];
};

type RankPeriodKey = 'allTime' | 'lastThreeMonths' | 'lastMeta';

type RankData = {
  allTime: RankPeriodData;
  lastThreeMonths: RankPeriodData;
  lastMeta: RankPeriodData;
};

type SaveMatchPlayersResponse = {
  ctScore: number | null;
  mapKey: string | null;
  mapName: string | null;
  playedAt: string;
  players: PlayerStat[];
  rank: RankData;
  tScore: number | null;
};

type LoadState =
  | { status: 'loading' }
  | {
      status: 'loaded';
      canonicalPlayers: CanonicalPlayer[];
      maps: CanonicalMap[];
      matches: MatchListItem[];
      rank: RankData;
    }
  | { status: 'error'; message: string };

type ActiveTab = 'rank' | 'matches';
type ScoreboardTeam = 'CT' | 'T' | 'unknown';
type EditablePlayerStatField = 'kills' | 'deaths' | 'assists' | 'headshotPercent' | 'damage';
type MatchOutcome = { label: string; status: 'draw' | 'lost' | 'won' };
const PRESERVE_CURRENT_MAP_KEY = '__preserve_current_map__';
const RANK_PERIODS: Array<{ key: RankPeriodKey; label: string }> = [
  { key: 'allTime', label: 'All Time' },
  { key: 'lastThreeMonths', label: '3 Months' },
  { key: 'lastMeta', label: 'Last Meta' }
];
type DraftPlayerStat = Omit<PlayerStat, EditablePlayerStatField | 'canonicalPlayerId'>
  & Record<EditablePlayerStatField, string>
  & { canonicalPlayerId: string };

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [activeTab, setActiveTab] = useState<ActiveTab>('rank');

  useEffect(() => {
    let ignore = false;

    Promise.all([
      fetchJson<{
        canonicalPlayers?: CanonicalPlayer[];
        maps?: CanonicalMap[];
        matches?: MatchListItem[];
      }>('/api/matches'),
      fetchJson<{ rank?: Partial<RankData> }>('/api/rank')
    ])
      .then(([matchesData, rankData]) => {
        if (!ignore) {
          setState({
            status: 'loaded',
            canonicalPlayers: matchesData.canonicalPlayers ?? [],
            maps: matchesData.maps ?? [],
            matches: matchesData.matches ?? [],
            rank: normalizeRankData(rankData.rank)
          });
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const handleMatchPlayersSave = async (
    matchId: number,
    mapKey: string | null | undefined,
    playedAt: string,
    ctScore: number | null,
    tScore: number | null,
    players: PlayerStat[]
  ) => {
    const result = await fetchJson<SaveMatchPlayersResponse>(`/api/matches/${matchId}/players`, {
      body: JSON.stringify({ ctScore, mapKey, playedAt, players, tScore }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT'
    });

    setState((current) => {
      if (current.status !== 'loaded') {
        return current;
      }

      return {
        ...current,
        rank: result.rank,
        matches: current.matches.map((match) => (
          match.id === matchId
            ? {
              ...match,
              ctScore: result.ctScore,
              mapKey: result.mapKey,
              mapName: result.mapName,
              playedAt: result.playedAt,
              players: result.players,
              tScore: result.tScore
            }
            : match
        ))
      };
    });

    return result.players;
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <nav className="top-nav" aria-label="Primary">
          <button
            className={activeTab === 'rank' ? 'active' : ''}
            type="button"
            onClick={() => setActiveTab('rank')}
          >
            Rank
          </button>
          <button
            className={activeTab === 'matches' ? 'active' : ''}
            type="button"
            onClick={() => setActiveTab('matches')}
          >
            Matches
          </button>
        </nav>
      </header>

      {state.status === 'loading' && <Status message="Loading extracted matches..." />}
      {state.status === 'error' && <Status tone="error" message={state.message} />}
      {state.status === 'loaded' && activeTab === 'rank' && (
        <RankView rank={state.rank} />
      )}
      {state.status === 'loaded' && activeTab === 'matches' && state.matches.length === 0 && (
        <Status message="No unique matches extracted yet." />
      )}
      {state.status === 'loaded' && activeTab === 'matches' && state.matches.length > 0 && (
        <section className="match-list" aria-label="Unique extracted matches">
          {state.matches.map((match) => (
            <MatchCard
              key={match.id}
              canonicalPlayers={state.canonicalPlayers}
              maps={state.maps}
              match={match}
              onPlayersSave={handleMatchPlayersSave}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function normalizeRankData(rank: Partial<RankData> | undefined): RankData {
  return {
    allTime: normalizeRankPeriod(rank?.allTime),
    lastThreeMonths: normalizeRankPeriod(rank?.lastThreeMonths),
    lastMeta: normalizeRankPeriod(rank?.lastMeta)
  };
}

function normalizeRankPeriod(period: Partial<RankPeriodData> | undefined): RankPeriodData {
  return {
    players: period?.players ?? [],
    maps: period?.maps ?? []
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await readResponseError(response, `Could not load ${url}.`));
  }

  return response.json() as Promise<T>;
}

async function readResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function RankView({ rank }: { rank: RankData }) {
  const [activePeriodKey, setActivePeriodKey] = useState<RankPeriodKey>('allTime');
  const activePeriod = RANK_PERIODS.find((period) => period.key === activePeriodKey) ?? RANK_PERIODS[0];

  return (
    <section className="rank-grid" aria-label="Player rankings">
      <div className="rank-sub-tabs" role="tablist" aria-label="Rank period">
        {RANK_PERIODS.map((period) => (
          <button
            key={period.key}
            aria-controls="rank-period-panel"
            aria-selected={period.key === activePeriodKey}
            className={period.key === activePeriodKey ? 'active' : ''}
            id={`rank-period-tab-${period.key}`}
            role="tab"
            type="button"
            onClick={() => setActivePeriodKey(period.key)}
          >
            {period.label}
          </button>
        ))}
      </div>
      <RankPeriod
        period={rank[activePeriod.key]}
        tabId={`rank-period-tab-${activePeriod.key}`}
      />
    </section>
  );
}

function RankPeriod({ period, tabId }: { period: RankPeriodData; tabId: string }) {
  return (
    <section
      aria-labelledby={tabId}
      className="rank-period"
      id="rank-period-panel"
      role="tabpanel"
    >
      <RankTable players={period.players} />
      <MapRankTable maps={period.maps} />
    </section>
  );
}

function RankTable({ players }: { players: RankPlayerStat[] }) {
  return (
    <article className="rank-panel">
      {players.length === 0 ? (
        <div className="empty-table">No player stats yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="player-rank-table">
            <thead>
              <tr>
                <th>Никнейм</th>
                <th>Матчи</th>
                <th>Убийства</th>
                <th>Смерти</th>
                <th>Помощи</th>
                <th>%ГЛ</th>
                <th>Урон</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.canonicalPlayerId ?? player.nickname}>
                  <td className="nickname">
                    <RankPlayerCell player={player} />
                  </td>
                  <td>{formatValue(player.matches)}</td>
                  <td>{formatValue(player.kills)}</td>
                  <td>{formatValue(player.deaths)}</td>
                  <td>{formatValue(player.assists)}</td>
                  <td>{formatPercent(player.headshotPercent)}</td>
                  <td>{formatValue(player.damage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function RankPlayerCell({ player }: { player: RankPlayerStat }) {
  const steamProfileUrl = getSafeSteamProfileUrl(player.steamProfileUrl);
  const content = (
    <span className="rank-player">
      {player.steamAvatarUrl ? (
        <img
          className="rank-avatar"
          src={player.steamAvatarUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="rank-avatar placeholder" aria-hidden="true">
          {getPlayerInitial(player.nickname)}
        </span>
      )}
      <span className="rank-player-name">{player.nickname}</span>
    </span>
  );

  return steamProfileUrl ? (
    <a className="rank-player-link" href={steamProfileUrl} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : content;
}

function MapRankTable({ maps }: { maps: RankMapStat[] }) {
  return (
    <article className="rank-panel map-rank-panel">
      {maps.length === 0 ? (
        <div className="empty-table">No map stats yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="map-rank-table">
            <thead>
              <tr>
                <th>Карта</th>
                <th>Матчи</th>
                <th>Победы</th>
                <th>Поражения</th>
                <th>Убийства</th>
                <th>Смерти</th>
                <th>Урон</th>
              </tr>
            </thead>
            <tbody>
              {maps.map((map) => (
                <tr key={map.mapName}>
                  <td className="nickname">{map.mapName}</td>
                  <td>{formatValue(map.matches)}</td>
                  <td>{formatValue(map.wins)}</td>
                  <td>{formatValue(map.losses)}</td>
                  <td>{formatValue(map.kills)}</td>
                  <td>{formatValue(map.deaths)}</td>
                  <td>{formatValue(map.damage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function MatchCard({
  canonicalPlayers,
  maps,
  match,
  onPlayersSave
}: {
  canonicalPlayers: CanonicalPlayer[];
  maps: CanonicalMap[];
  match: MatchListItem;
  onPlayersSave: (
    matchId: number,
    mapKey: string | null | undefined,
    playedAt: string,
    ctScore: number | null,
    tScore: number | null,
    players: PlayerStat[]
  ) => Promise<PlayerStat[]>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftCtScore, setDraftCtScore] = useState(() => toDraftValue(match.ctScore));
  const [draftMapKey, setDraftMapKey] = useState(() => toDraftMapKey(match));
  const [draftPlayedAt, setDraftPlayedAt] = useState(() => toDateTimeLocalValue(match.playedAt));
  const [draftPlayers, setDraftPlayers] = useState<DraftPlayerStat[]>(() => toDraftPlayers(match.players));
  const [draftTScore, setDraftTScore] = useState(() => toDraftValue(match.tScore));
  const matchOutcome = getMatchOutcome(match);

  useEffect(() => {
    if (!isEditing) {
      setDraftCtScore(toDraftValue(match.ctScore));
      setDraftMapKey(toDraftMapKey(match));
      setDraftPlayedAt(toDateTimeLocalValue(match.playedAt));
      setDraftPlayers(toDraftPlayers(match.players));
      setDraftTScore(toDraftValue(match.tScore));
    }
  }, [isEditing, match, match.players]);

  const handleEdit = () => {
    setDraftCtScore(toDraftValue(match.ctScore));
    setDraftMapKey(toDraftMapKey(match));
    setDraftPlayedAt(toDateTimeLocalValue(match.playedAt));
    setDraftPlayers(toDraftPlayers(match.players));
    setDraftTScore(toDraftValue(match.tScore));
    setSaveError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setDraftCtScore(toDraftValue(match.ctScore));
    setDraftMapKey(toDraftMapKey(match));
    setDraftPlayedAt(toDateTimeLocalValue(match.playedAt));
    setDraftPlayers(toDraftPlayers(match.players));
    setDraftTScore(toDraftValue(match.tScore));
    setSaveError(null);
    setIsEditing(false);
  };

  const handleSave = async () => {
    const savedPlayers = draftPlayers.map((player) => fromDraftPlayer(player, canonicalPlayers));
    const playedAt = new Date(draftPlayedAt);

    if (!draftPlayedAt || Number.isNaN(playedAt.getTime())) {
      setSaveError('Enter a valid match date and time.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const mapKey = draftMapKey === PRESERVE_CURRENT_MAP_KEY
        ? undefined
        : draftMapKey || null;
      const refreshedPlayers = await onPlayersSave(
        match.id,
        mapKey,
        playedAt.toISOString(),
        parseDraftInteger(draftCtScore),
        parseDraftInteger(draftTScore),
        savedPlayers
      );
      setDraftPlayers(toDraftPlayers(refreshedPlayers));
      setIsEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDraftChange = (
    playerIndex: number,
    field: EditablePlayerStatField,
    value: string
  ) => {
    setDraftPlayers((players) => players.map((player, index) => (
      index === playerIndex ? { ...player, [field]: value } : player
    )));
  };

  const handleCanonicalPlayerChange = (playerIndex: number, value: string) => {
    setDraftPlayers((players) => players.map((player, index) => (
      index === playerIndex ? { ...player, canonicalPlayerId: value } : player
    )));
  };

  return (
    <article className="match-card">
      <a className="screenshot-link" href={`/images/${match.imageId}`} target="_blank" rel="noreferrer">
        <img
          src={`/images/${match.imageId}`}
          alt={`Scoreboard screenshot for ${match.mapName ?? 'unknown map'}`}
          loading="lazy"
        />
        {matchOutcome && (
          <span className={`match-outcome ${matchOutcome.status}`}>
            {matchOutcome.label}
          </span>
        )}
        <span className="image-open">Open image</span>
      </a>

      <div className="score-stack" aria-label="Match score">
        <ScoreChip
          accent="ct"
          disabled={isSaving}
          draftValue={draftCtScore}
          isEditing={isEditing}
          label="CT"
          onDraftChange={setDraftCtScore}
          value={match.ctScore}
        />
        <ScoreChip
          accent="t"
          disabled={isSaving}
          draftValue={draftTScore}
          isEditing={isEditing}
          label="T"
          onDraftChange={setDraftTScore}
          value={match.tScore}
        />
      </div>

      <section className="match-detail">
        <div className="match-title-row">
          <div>
            {isEditing ? (
              <input
                aria-label="Match date and time"
                className="match-date-input"
                disabled={isSaving}
                onChange={(event) => setDraftPlayedAt(event.target.value)}
                required
                type="datetime-local"
                value={draftPlayedAt}
              />
            ) : (
              <p className="row-kicker">{formatDate(match.playedAt)}</p>
            )}
            {isEditing ? (
              <select
                aria-label="Match map"
                className="map-select"
                disabled={isSaving}
                value={draftMapKey}
                onChange={(event) => setDraftMapKey(event.target.value)}
              >
                {match.mapKey === null && match.mapName && (
                  <option value={PRESERVE_CURRENT_MAP_KEY}>
                    Current: {match.mapName}
                  </option>
                )}
                <option value="">Unknown map</option>
                {maps.map((map) => (
                  <option key={map.mapKey} value={map.mapKey}>
                    {map.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <h2>{match.mapName ?? 'Unknown map'}</h2>
            )}
          </div>
          <div className="match-actions">
            {match.duplicateCount > 0 && (
              <span className="duplicate-pill">
                {match.screenshotCount} screenshots, {match.duplicateCount} duplicate
                {match.duplicateCount === 1 ? '' : 's'} hidden
              </span>
            )}
            <button className="secondary-action" type="button" onClick={handleEdit} disabled={isEditing || isSaving}>
              Edit
            </button>
            {isEditing && (
              <>
                <button className="secondary-action" type="button" onClick={handleCancel} disabled={isSaving}>
                  Cancel
                </button>
                <button className="primary-action" type="button" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
        {saveError && <div className="save-error" role="alert">{saveError}</div>}
        <PlayerTable
          canonicalPlayers={canonicalPlayers}
          draftPlayers={draftPlayers}
          isEditing={isEditing}
          isSaving={isSaving}
          onCanonicalPlayerChange={handleCanonicalPlayerChange}
          onDraftChange={handleDraftChange}
          players={match.players}
        />
      </section>
    </article>
  );
}

function ScoreChip({
  accent,
  disabled,
  draftValue,
  isEditing,
  label,
  onDraftChange,
  value
}: {
  accent: 'ct' | 't';
  disabled: boolean;
  draftValue: string;
  isEditing: boolean;
  label: string;
  onDraftChange: (value: string) => void;
  value: number | null;
}) {
  return (
    <div className={`score-chip ${accent}`}>
      <span className="score-label">{label}</span>
      {isEditing ? (
        <input
          aria-label={`${label} score`}
          className="score-input"
          disabled={disabled}
          inputMode="numeric"
          min={0}
          type="number"
          value={draftValue}
          onChange={(event) => onDraftChange(event.target.value)}
        />
      ) : (
        <strong>{formatValue(value)}</strong>
      )}
    </div>
  );
}

function PlayerTable({
  canonicalPlayers,
  draftPlayers,
  isEditing,
  isSaving,
  onCanonicalPlayerChange,
  onDraftChange,
  players
}: {
  canonicalPlayers: CanonicalPlayer[];
  draftPlayers: DraftPlayerStat[];
  isEditing: boolean;
  isSaving: boolean;
  onCanonicalPlayerChange: (playerIndex: number, value: string) => void;
  onDraftChange: (playerIndex: number, field: EditablePlayerStatField, value: string) => void;
  players: PlayerStat[];
}) {
  if (players.length === 0) {
    return (
      <div className="empty-table">
        No team players found in this extraction yet.
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Никнейм</th>
            <th>Убийства</th>
            <th>Смерти</th>
            <th>Помощи</th>
            <th>%ГЛ</th>
            <th>Урон</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player, index) => {
            const draftPlayer = draftPlayers[index] ?? toDraftPlayer(player);
            const isCanonicalPlayerMissing = isEditing
              ? draftPlayer.canonicalPlayerId === ''
              : player.canonicalPlayerId === null;

            return (
              <tr className={isCanonicalPlayerMissing ? 'unresolved-player-row' : undefined} key={player.id}>
                <PlayerNameCell
                  canonicalPlayers={canonicalPlayers}
                  draftPlayer={draftPlayer}
                  isEditing={isEditing}
                  isSaving={isSaving}
                  onCanonicalPlayerChange={onCanonicalPlayerChange}
                  player={player}
                  playerIndex={index}
                />
                <EditableStatCell
                  field="kills"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.kills}
                  draftValue={draftPlayer.kills}
                  disabled={isSaving}
                  onDraftChange={onDraftChange}
                />
                <EditableStatCell
                  field="deaths"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.deaths}
                  draftValue={draftPlayer.deaths}
                  disabled={isSaving}
                  onDraftChange={onDraftChange}
                />
                <EditableStatCell
                  field="assists"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.assists}
                  draftValue={draftPlayer.assists}
                  disabled={isSaving}
                  onDraftChange={onDraftChange}
                />
                <EditableStatCell
                  field="headshotPercent"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.headshotPercent}
                  draftValue={draftPlayer.headshotPercent}
                  disabled={isSaving}
                  onDraftChange={onDraftChange}
                  formatter={formatPercent}
                />
                <EditableStatCell
                  field="damage"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.damage}
                  draftValue={draftPlayer.damage}
                  disabled={isSaving}
                  onDraftChange={onDraftChange}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlayerNameCell({
  canonicalPlayers,
  draftPlayer,
  isEditing,
  isSaving,
  onCanonicalPlayerChange,
  player,
  playerIndex
}: {
  canonicalPlayers: CanonicalPlayer[];
  draftPlayer: DraftPlayerStat;
  isEditing: boolean;
  isSaving: boolean;
  onCanonicalPlayerChange: (playerIndex: number, value: string) => void;
  player: PlayerStat;
  playerIndex: number;
}) {
  if (!isEditing) {
    return <td className="nickname">{player.nickname}</td>;
  }

  const extractedName = player.rawNickname ?? player.nickname;

  return (
    <td className="nickname player-name-cell">
      <select
        aria-label={`Canonical player for ${extractedName}`}
        className="player-select"
        disabled={isSaving}
        value={draftPlayer.canonicalPlayerId}
        onChange={(event) => onCanonicalPlayerChange(playerIndex, event.target.value)}
      >
        <option value="">Not attached</option>
        {canonicalPlayers.map((canonicalPlayer) => (
          <option key={canonicalPlayer.id} value={canonicalPlayer.id}>
            {canonicalPlayer.displayName}
          </option>
        ))}
      </select>
      <span className="raw-nickname">Extracted: {extractedName}</span>
    </td>
  );
}

function EditableStatCell({
  disabled,
  draftValue,
  field,
  formatter = formatValue,
  isEditing,
  onDraftChange,
  playerIndex,
  value
}: {
  disabled: boolean;
  draftValue: string;
  field: EditablePlayerStatField;
  formatter?: (value: number | null | undefined) => string;
  isEditing: boolean;
  onDraftChange: (playerIndex: number, field: EditablePlayerStatField, value: string) => void;
  playerIndex: number;
  value: number | null;
}) {
  if (!isEditing) {
    return <td>{formatter(value)}</td>;
  }

  return (
    <td>
      <input
        aria-label={field}
        className="stat-input"
        disabled={disabled}
        inputMode="numeric"
        min={0}
        type="number"
        value={draftValue}
        onChange={(event) => onDraftChange(playerIndex, field, event.target.value)}
      />
    </td>
  );
}

function Status({ message, tone = 'neutral' }: { message: string; tone?: 'neutral' | 'error' }) {
  return <div className={`status ${tone}`}>{message}</div>;
}

function formatValue(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : String(value);
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${value}%`;
}

function getSafeSteamProfileUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function getPlayerInitial(nickname: string): string {
  return nickname.trim().slice(0, 1).toUpperCase() || '?';
}

function toDraftPlayers(players: PlayerStat[]): DraftPlayerStat[] {
  return players.map(toDraftPlayer);
}

function toDraftPlayer(player: PlayerStat): DraftPlayerStat {
  return {
    id: player.id,
    nickname: player.nickname,
    rawNickname: player.rawNickname,
    canonicalPlayerId: player.canonicalPlayerId === null ? '' : String(player.canonicalPlayerId),
    canonicalNickname: player.canonicalNickname,
    team: player.team,
    kills: toDraftValue(player.kills),
    deaths: toDraftValue(player.deaths),
    assists: toDraftValue(player.assists),
    headshotPercent: toDraftValue(player.headshotPercent),
    damage: toDraftValue(player.damage)
  };
}

function fromDraftPlayer(player: DraftPlayerStat, canonicalPlayers: CanonicalPlayer[]): PlayerStat {
  const canonicalPlayerId = parseDraftInteger(player.canonicalPlayerId);
  const canonicalPlayer = canonicalPlayers.find((candidate) => candidate.id === canonicalPlayerId);

  return {
    id: player.id,
    nickname: canonicalPlayer?.displayName ?? player.rawNickname ?? player.nickname,
    rawNickname: player.rawNickname,
    canonicalPlayerId,
    canonicalNickname: canonicalPlayer?.displayName ?? null,
    team: player.team,
    kills: parseDraftInteger(player.kills),
    deaths: parseDraftInteger(player.deaths),
    assists: parseDraftInteger(player.assists),
    headshotPercent: parseDraftInteger(player.headshotPercent),
    damage: parseDraftInteger(player.damage)
  };
}

function toDraftValue(value: number | null): string {
  return value === null ? '' : String(value);
}

function parseDraftInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDraftMapKey(match: MatchListItem): string {
  if (match.mapKey) {
    return match.mapKey;
  }

  return match.mapName ? PRESERVE_CURRENT_MAP_KEY : '';
}

function toDateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getMatchOutcome(match: MatchListItem): MatchOutcome | null {
  const team = match.players.find((player) => player.team === 'CT' || player.team === 'T')?.team;
  if (!team || match.ctScore === null || match.tScore === null) {
    return null;
  }

  const teamScore = team === 'CT' ? match.ctScore : match.tScore;
  const opponentScore = team === 'CT' ? match.tScore : match.ctScore;

  if (teamScore === opponentScore) {
    return { label: 'Draw', status: 'draw' };
  }

  return teamScore > opponentScore
    ? { label: 'Won', status: 'won' }
    : { label: 'Lost', status: 'lost' };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short'
  }).format(new Date(value));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
