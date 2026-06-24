CREATE TABLE IF NOT EXISTS players (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(display_name) <> '')
);

CREATE TABLE IF NOT EXISTS player_aliases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  alias_text text NOT NULL,
  normalized_alias text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, normalized_alias),
  CHECK (btrim(alias_text) <> ''),
  CHECK (btrim(normalized_alias) <> ''),
  CHECK (status IN ('confirmed', 'suggested', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS player_aliases_confirmed_normalized_alias_key
  ON player_aliases (normalized_alias)
  WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS match_player_stats (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_extraction_player_id integer NOT NULL UNIQUE REFERENCES match_extraction_players(id) ON DELETE CASCADE,
  player_id integer REFERENCES players(id) ON DELETE SET NULL,
  resolved_alias_id integer REFERENCES player_aliases(id) ON DELETE SET NULL,
  resolution_status text NOT NULL DEFAULT 'unresolved',
  raw_nickname text,
  normalized_nickname text,
  team text NOT NULL,
  kills integer,
  deaths integer,
  assists integer,
  adr_or_kast integer,
  damage integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (resolution_status IN ('resolved', 'unresolved')),
  CHECK (
    (
      resolution_status = 'resolved'
      AND player_id IS NOT NULL
      AND resolved_alias_id IS NOT NULL
    )
    OR (
      resolution_status = 'unresolved'
      AND player_id IS NULL
      AND resolved_alias_id IS NULL
    )
  ),
  CHECK (team IN ('CT', 'T', 'unknown')),
  CHECK (kills IS NULL OR kills >= 0),
  CHECK (deaths IS NULL OR deaths >= 0),
  CHECK (assists IS NULL OR assists >= 0),
  CHECK (adr_or_kast IS NULL OR adr_or_kast >= 0),
  CHECK (damage IS NULL OR damage >= 0)
);

CREATE INDEX IF NOT EXISTS match_player_stats_player_id_idx
  ON match_player_stats (player_id);

CREATE INDEX IF NOT EXISTS match_player_stats_normalized_nickname_idx
  ON match_player_stats (normalized_nickname);

CREATE OR REPLACE FUNCTION refresh_match_player_stats_for_alias()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE match_player_stats
    SET
      player_id = NULL,
      resolved_alias_id = NULL,
      resolution_status = 'unresolved',
      updated_at = now()
    WHERE resolved_alias_id = OLD.id;

    RETURN OLD;
  END IF;

  IF (
    TG_OP = 'UPDATE'
    AND OLD.status = 'confirmed'
    AND (
      NEW.status <> 'confirmed'
      OR OLD.player_id <> NEW.player_id
      OR OLD.normalized_alias <> NEW.normalized_alias
    )
  ) THEN
    UPDATE match_player_stats
    SET
      player_id = NULL,
      resolved_alias_id = NULL,
      resolution_status = 'unresolved',
      updated_at = now()
    WHERE resolved_alias_id = OLD.id;
  END IF;

  IF NEW.status = 'confirmed' THEN
    UPDATE match_player_stats
    SET
      player_id = NEW.player_id,
      resolved_alias_id = NEW.id,
      resolution_status = 'resolved',
      updated_at = now()
    WHERE normalized_nickname = NEW.normalized_alias
      AND (
        player_id IS NULL
        OR resolved_alias_id = NEW.id
      );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS player_aliases_refresh_match_player_stats ON player_aliases;

CREATE TRIGGER player_aliases_refresh_match_player_stats
AFTER INSERT OR UPDATE OF player_id, normalized_alias, status
ON player_aliases
FOR EACH ROW
EXECUTE FUNCTION refresh_match_player_stats_for_alias();

DROP TRIGGER IF EXISTS player_aliases_unresolve_deleted_match_player_stats ON player_aliases;

CREATE TRIGGER player_aliases_unresolve_deleted_match_player_stats
BEFORE DELETE
ON player_aliases
FOR EACH ROW
EXECUTE FUNCTION refresh_match_player_stats_for_alias();
