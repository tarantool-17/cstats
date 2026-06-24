CREATE TABLE IF NOT EXISTS match_extractions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  extraction_job_id integer NOT NULL UNIQUE REFERENCES extraction_jobs(id) ON DELETE CASCADE,
  image_asset_id integer NOT NULL UNIQUE REFERENCES image_assets(id) ON DELETE CASCADE,
  map_name text,
  ct_score integer,
  t_score integer,
  confidence double precision,
  warnings text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ct_score IS NULL OR ct_score >= 0),
  CHECK (t_score IS NULL OR t_score >= 0)
);

CREATE TABLE IF NOT EXISTS match_extraction_players (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_extraction_id integer NOT NULL REFERENCES match_extractions(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  team text NOT NULL,
  raw_nickname text,
  kills integer,
  deaths integer,
  assists integer,
  adr_or_kast integer,
  damage integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_extraction_id, row_number),
  CHECK (row_number > 0),
  CHECK (team IN ('CT', 'T', 'unknown')),
  CHECK (kills IS NULL OR kills >= 0),
  CHECK (deaths IS NULL OR deaths >= 0),
  CHECK (assists IS NULL OR assists >= 0),
  CHECK (adr_or_kast IS NULL OR adr_or_kast >= 0),
  CHECK (damage IS NULL OR damage >= 0)
);

CREATE INDEX IF NOT EXISTS match_extraction_players_raw_nickname_idx
  ON match_extraction_players (raw_nickname);

CREATE INDEX IF NOT EXISTS match_extraction_players_match_team_idx
  ON match_extraction_players (match_extraction_id, team);
