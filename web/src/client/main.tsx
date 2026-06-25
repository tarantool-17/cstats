import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

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
  players: PlayerStat[];
};

type PlayerStat = {
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

type RankData = {
  allTime: RankPlayerStat[];
  lastThreeMonths: RankPlayerStat[];
};

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; canonicalPlayers: CanonicalPlayer[]; matches: MatchListItem[]; rank: RankData }
  | { status: 'error'; message: string };

type ActiveTab = 'rank' | 'matches';
type ScoreboardTeam = 'CT' | 'T' | 'unknown';
type EditablePlayerStatField = 'kills' | 'deaths' | 'assists' | 'headshotPercent' | 'damage';
type DraftPlayerStat = Omit<PlayerStat, EditablePlayerStatField | 'canonicalPlayerId'>
  & Record<EditablePlayerStatField, string>
  & { canonicalPlayerId: string };

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [activeTab, setActiveTab] = useState<ActiveTab>('rank');

  useEffect(() => {
    let ignore = false;

    Promise.all([
      fetchJson<{ canonicalPlayers?: CanonicalPlayer[]; matches?: MatchListItem[] }>('/api/matches'),
      fetchJson<{ rank?: Partial<RankData> }>('/api/rank')
    ])
      .then(([matchesData, rankData]) => {
        const rank = {
          allTime: rankData.rank?.allTime ?? [],
          lastThreeMonths: rankData.rank?.lastThreeMonths ?? []
        };

        if (!ignore) {
          setState({
            status: 'loaded',
            canonicalPlayers: matchesData.canonicalPlayers ?? [],
            matches: matchesData.matches ?? [],
            rank
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

  const title = activeTab === 'rank' ? 'Team Rank' : 'Unique Matches';
  const handleMatchPlayersSave = (matchId: number, players: PlayerStat[]) => {
    setState((current) => {
      if (current.status !== 'loaded') {
        return current;
      }

      return {
        ...current,
        matches: current.matches.map((match) => (
          match.id === matchId ? { ...match, players } : match
        ))
      };
    });
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-title">
          <p className="eyebrow">CStats local dashboard</p>
          <h1>{title}</h1>
        </div>
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
        <div className="summary-strip" aria-label="Dashboard summary">
          <SummaryItem label="Matches" value={state.status === 'loaded' ? state.matches.length : '...'} />
        </div>
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
              match={match}
              onPlayersSave={handleMatchPlayersSave}
            />
          ))}
        </section>
      )}
    </main>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}.`);
  }

  return response.json() as Promise<T>;
}

function SummaryItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="summary-item">
      <span className="summary-value">{value}</span>
      <span className="summary-label">{label}</span>
    </div>
  );
}

function RankView({ rank }: { rank: RankData }) {
  return (
    <section className="rank-grid" aria-label="Player rankings">
      <RankTable title="All Time" players={rank.allTime} />
      <RankTable title="Last 3 Months" players={rank.lastThreeMonths} />
    </section>
  );
}

function RankTable({ players, title }: { players: RankPlayerStat[]; title: string }) {
  return (
    <article className="rank-panel">
      <div className="rank-title-row">
        <div>
          <p className="row-kicker">Sorted by Урон</p>
          <h2>{title}</h2>
        </div>
        <span className="rank-count">{players.length} players</span>
      </div>
      {players.length === 0 ? (
        <div className="empty-table">No player stats yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
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
                <tr key={player.nickname}>
                  <td className="nickname">{player.nickname}</td>
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

function MatchCard({
  canonicalPlayers,
  match,
  onPlayersSave
}: {
  canonicalPlayers: CanonicalPlayer[];
  match: MatchListItem;
  onPlayersSave: (matchId: number, players: PlayerStat[]) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftPlayers, setDraftPlayers] = useState<DraftPlayerStat[]>(() => toDraftPlayers(match.players));

  useEffect(() => {
    if (!isEditing) {
      setDraftPlayers(toDraftPlayers(match.players));
    }
  }, [isEditing, match.players]);

  const handleEdit = () => {
    setDraftPlayers(toDraftPlayers(match.players));
    setIsEditing(true);
  };

  const handleSave = () => {
    const savedPlayers = draftPlayers.map((player) => fromDraftPlayer(player, canonicalPlayers));
    onPlayersSave(match.id, savedPlayers);
    setIsEditing(false);
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
        <span className="image-open">Open image</span>
      </a>

      <div className="score-stack" aria-label="Match score">
        <ScoreChip label="CT" value={match.ctScore} accent="ct" />
        <ScoreChip label="T" value={match.tScore} accent="t" />
      </div>

      <section className="match-detail">
        <div className="match-title-row">
          <div>
            <p className="row-kicker">{formatDate(match.imageCreatedAt)}</p>
            <h2>{match.mapName ?? 'Unknown map'}</h2>
          </div>
          <div className="match-actions">
            {match.duplicateCount > 0 && (
              <span className="duplicate-pill">
                {match.screenshotCount} screenshots, {match.duplicateCount} duplicate
                {match.duplicateCount === 1 ? '' : 's'} hidden
              </span>
            )}
            <button className="secondary-action" type="button" onClick={handleEdit} disabled={isEditing}>
              Edit
            </button>
            {isEditing && (
              <button className="primary-action" type="button" onClick={handleSave}>
                Save
              </button>
            )}
          </div>
        </div>
        <PlayerTable
          canonicalPlayers={canonicalPlayers}
          draftPlayers={draftPlayers}
          isEditing={isEditing}
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
  label,
  value
}: {
  accent: 'ct' | 't';
  label: string;
  value: number | null;
}) {
  return (
    <div className={`score-chip ${accent}`}>
      <span className="score-label">{label}</span>
      <strong>{formatValue(value)}</strong>
    </div>
  );
}

function PlayerTable({
  canonicalPlayers,
  draftPlayers,
  isEditing,
  onCanonicalPlayerChange,
  onDraftChange,
  players
}: {
  canonicalPlayers: CanonicalPlayer[];
  draftPlayers: DraftPlayerStat[];
  isEditing: boolean;
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

            return (
              <tr key={`${player.nickname}-${index}`}>
                <PlayerNameCell
                  canonicalPlayers={canonicalPlayers}
                  draftPlayer={draftPlayer}
                  isEditing={isEditing}
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
                  onDraftChange={onDraftChange}
                />
                <EditableStatCell
                  field="deaths"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.deaths}
                  draftValue={draftPlayer.deaths}
                  onDraftChange={onDraftChange}
                />
                <EditableStatCell
                  field="assists"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.assists}
                  draftValue={draftPlayer.assists}
                  onDraftChange={onDraftChange}
                />
                <EditableStatCell
                  field="headshotPercent"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.headshotPercent}
                  draftValue={draftPlayer.headshotPercent}
                  onDraftChange={onDraftChange}
                  formatter={formatPercent}
                />
                <EditableStatCell
                  field="damage"
                  isEditing={isEditing}
                  playerIndex={index}
                  value={player.damage}
                  draftValue={draftPlayer.damage}
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
  onCanonicalPlayerChange,
  player,
  playerIndex
}: {
  canonicalPlayers: CanonicalPlayer[];
  draftPlayer: DraftPlayerStat;
  isEditing: boolean;
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
  draftValue,
  field,
  formatter = formatValue,
  isEditing,
  onDraftChange,
  playerIndex,
  value
}: {
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
        inputMode="numeric"
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

function toDraftPlayers(players: PlayerStat[]): DraftPlayerStat[] {
  return players.map(toDraftPlayer);
}

function toDraftPlayer(player: PlayerStat): DraftPlayerStat {
  return {
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
