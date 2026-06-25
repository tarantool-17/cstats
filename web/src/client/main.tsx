import { StrictMode, useEffect, useMemo, useState } from 'react';
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
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  headshotPercent: number | null;
  damage: number | null;
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
  | { status: 'loaded'; matches: MatchListItem[]; rank: RankData }
  | { status: 'error'; message: string };

type ActiveTab = 'rank' | 'matches';

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [activeTab, setActiveTab] = useState<ActiveTab>('rank');

  useEffect(() => {
    let ignore = false;

    Promise.all([
      fetchJson<{ matches?: MatchListItem[] }>('/api/matches'),
      fetchJson<{ rank?: Partial<RankData> }>('/api/rank')
    ])
      .then(([matchesData, rankData]) => {
        const rank = {
          allTime: rankData.rank?.allTime ?? [],
          lastThreeMonths: rankData.rank?.lastThreeMonths ?? []
        };

        if (!ignore) {
          setState({ status: 'loaded', matches: matchesData.matches ?? [], rank });
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

  const uniquePlayerCount = useMemo(() => {
    if (state.status !== 'loaded') {
      return 0;
    }

    return new Set(
      state.matches.flatMap((match) => match.players.map((player) => player.nickname))
    ).size;
  }, [state]);
  const title = activeTab === 'rank' ? 'Team Rank' : 'Unique Matches';

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
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
          <SummaryItem label="Players" value={state.status === 'loaded' ? uniquePlayerCount : '...'} />
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
            <MatchCard key={match.id} match={match} />
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

function MatchCard({ match }: { match: MatchListItem }) {
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
          {match.duplicateCount > 0 && (
            <span className="duplicate-pill">
              {match.screenshotCount} screenshots, {match.duplicateCount} duplicate
              {match.duplicateCount === 1 ? '' : 's'} hidden
            </span>
          )}
        </div>
        <PlayerTable players={match.players} />
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

function PlayerTable({ players }: { players: PlayerStat[] }) {
  if (players.length === 0) {
    return (
      <div className="empty-table">
        No known team players found in this extraction yet.
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
          {players.map((player, index) => (
            <tr key={`${player.nickname}-${index}`}>
              <td className="nickname">{player.nickname}</td>
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
