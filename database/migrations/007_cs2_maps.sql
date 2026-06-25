CREATE TABLE IF NOT EXISTS cs2_maps (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  map_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  file_name text NOT NULL UNIQUE,
  category text NOT NULL,
  is_active_duty boolean NOT NULL DEFAULT false,
  is_current_pool boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(map_key) <> ''),
  CHECK (btrim(display_name) <> ''),
  CHECK (btrim(file_name) <> ''),
  CHECK (category IN ('active_duty', 'core', 'community_rotation'))
);

CREATE TABLE IF NOT EXISTS cs2_map_aliases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  map_id integer NOT NULL REFERENCES cs2_maps(id) ON DELETE CASCADE,
  alias_text text NOT NULL,
  normalized_alias text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(alias_text) <> ''),
  CHECK (btrim(normalized_alias) <> '')
);

CREATE INDEX IF NOT EXISTS cs2_map_aliases_map_id_idx
  ON cs2_map_aliases (map_id);

WITH seed_maps (map_key, display_name, file_name, category, is_active_duty, is_current_pool) AS (
  VALUES
    ('de_ancient', 'Ancient', 'de_ancient', 'active_duty', true, true),
    ('de_anubis', 'Anubis', 'de_anubis', 'active_duty', true, true),
    ('de_dust2', 'Dust II', 'de_dust2', 'active_duty', true, true),
    ('de_inferno', 'Inferno', 'de_inferno', 'active_duty', true, true),
    ('de_mirage', 'Mirage', 'de_mirage', 'active_duty', true, true),
    ('de_nuke', 'Nuke', 'de_nuke', 'active_duty', true, true),
    ('de_overpass', 'Overpass', 'de_overpass', 'active_duty', true, true),
    ('de_cache', 'Cache', 'de_cache', 'core', false, true),
    ('de_train', 'Train', 'de_train', 'core', false, true),
    ('de_vertigo', 'Vertigo', 'de_vertigo', 'core', false, true),
    ('cs_italy', 'Italy', 'cs_italy', 'core', false, true),
    ('cs_office', 'Office', 'cs_office', 'core', false, true),
    ('ar_baggage', 'Baggage', 'ar_baggage', 'core', false, true),
    ('ar_shoots', 'Shoots', 'ar_shoots', 'core', false, true),
    ('ar_pool_day', 'Pool Day', 'ar_pool_day', 'core', false, true),
    ('de_alpine', 'Alpine', 'de_alpine', 'community_rotation', false, true),
    ('de_stronghold', 'Stronghold', 'de_stronghold', 'community_rotation', false, true),
    ('de_warden', 'Warden', 'de_warden', 'community_rotation', false, true),
    ('de_poseidon', 'Poseidon', 'de_poseidon', 'community_rotation', false, true),
    ('de_sanctum', 'Sanctum', 'de_sanctum', 'community_rotation', false, true)
)
INSERT INTO cs2_maps (
  map_key,
  display_name,
  file_name,
  category,
  is_active_duty,
  is_current_pool
)
SELECT
  map_key,
  display_name,
  file_name,
  category,
  is_active_duty,
  is_current_pool
FROM seed_maps
ON CONFLICT (map_key) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  file_name = EXCLUDED.file_name,
  category = EXCLUDED.category,
  is_active_duty = EXCLUDED.is_active_duty,
  is_current_pool = EXCLUDED.is_current_pool,
  updated_at = now();

WITH seed_aliases (map_key, alias_text, normalized_alias) AS (
  VALUES
    ('de_ancient', 'Ancient', 'ancient'),
    ('de_ancient', 'de_ancient', 'deancient'),
    ('de_anubis', 'Anubis', 'anubis'),
    ('de_anubis', 'de_anubis', 'deanubis'),
    ('de_dust2', 'Dust II', 'dustii'),
    ('de_dust2', 'Dust 2', 'dust2'),
    ('de_dust2', 'Dust2', 'dust2'),
    ('de_dust2', 'D2', 'd2'),
    ('de_dust2', 'de_dust2', 'dedust2'),
    ('de_dust2', 'bust2', 'bust2'),
    ('de_inferno', 'Inferno', 'inferno'),
    ('de_inferno', 'de_inferno', 'deinferno'),
    ('de_mirage', 'Mirage', 'mirage'),
    ('de_mirage', 'de_mirage', 'demirage'),
    ('de_nuke', 'Nuke', 'nuke'),
    ('de_nuke', 'de_nuke', 'denuke'),
    ('de_overpass', 'Overpass', 'overpass'),
    ('de_overpass', 'de_overpass', 'deoverpass'),
    ('de_cache', 'Cache', 'cache'),
    ('de_cache', 'de_cache', 'decache'),
    ('de_train', 'Train', 'train'),
    ('de_train', 'de_train', 'detrain'),
    ('de_vertigo', 'Vertigo', 'vertigo'),
    ('de_vertigo', 'de_vertigo', 'devertigo'),
    ('cs_italy', 'Italy', 'italy'),
    ('cs_italy', 'cs_italy', 'csitaly'),
    ('cs_office', 'Office', 'office'),
    ('cs_office', 'cs_office', 'csoffice'),
    ('ar_baggage', 'Baggage', 'baggage'),
    ('ar_baggage', 'ar_baggage', 'arbaggage'),
    ('ar_shoots', 'Shoots', 'shoots'),
    ('ar_shoots', 'ar_shoots', 'arshoots'),
    ('ar_pool_day', 'Pool Day', 'poolday'),
    ('ar_pool_day', 'PoolDay', 'poolday'),
    ('ar_pool_day', 'ar_pool_day', 'arpoolday'),
    ('de_alpine', 'Alpine', 'alpine'),
    ('de_alpine', 'de_alpine', 'dealpine'),
    ('de_stronghold', 'Stronghold', 'stronghold'),
    ('de_stronghold', 'de_stronghold', 'destronghold'),
    ('de_warden', 'Warden', 'warden'),
    ('de_warden', 'de_warden', 'dewarden'),
    ('de_poseidon', 'Poseidon', 'poseidon'),
    ('de_poseidon', 'de_poseidon', 'deposeidon'),
    ('de_sanctum', 'Sanctum', 'sanctum'),
    ('de_sanctum', 'de_sanctum', 'desanctum')
),
deduped_aliases AS (
  SELECT DISTINCT ON (normalized_alias)
    map_key,
    alias_text,
    normalized_alias
  FROM seed_aliases
  ORDER BY
    normalized_alias,
    map_key,
    length(alias_text),
    alias_text
)
INSERT INTO cs2_map_aliases (map_id, alias_text, normalized_alias)
SELECT
  cs2_maps.id,
  deduped_aliases.alias_text,
  deduped_aliases.normalized_alias
FROM deduped_aliases
JOIN cs2_maps ON cs2_maps.map_key = deduped_aliases.map_key
ON CONFLICT (normalized_alias) DO UPDATE
SET
  map_id = EXCLUDED.map_id,
  alias_text = EXCLUDED.alias_text,
  updated_at = now();
