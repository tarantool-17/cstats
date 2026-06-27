ALTER TABLE players
  ADD COLUMN IF NOT EXISTS steam_id64 text,
  ADD COLUMN IF NOT EXISTS steam_persona_name text,
  ADD COLUMN IF NOT EXISTS steam_profile_url text,
  ADD COLUMN IF NOT EXISTS steam_avatar_url text,
  ADD COLUMN IF NOT EXISTS steam_real_name text,
  ADD COLUMN IF NOT EXISTS steam_custom_url text,
  ADD COLUMN IF NOT EXISTS steam_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS players_steam_id64_key
  ON players (steam_id64)
  WHERE steam_id64 IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'players_steam_id64_format_check'
  ) THEN
    ALTER TABLE players
      ADD CONSTRAINT players_steam_id64_format_check
      CHECK (steam_id64 IS NULL OR steam_id64 ~ '^[0-9]{17}$');
  END IF;
END;
$$;

WITH seed_profiles (
  player_id,
  steam_id64,
  steam_persona_name,
  steam_profile_url,
  steam_avatar_url,
  steam_real_name,
  steam_custom_url
) AS (
  VALUES
    (
      3,
      '76561199247287952',
      'valdemar',
      'https://steamcommunity.com/profiles/76561199247287952',
      'https://avatars.fastly.steamstatic.com/f67ed48e8d3ff9da66365d21cd92171bee161c7a_full.jpg',
      'Vladimir',
      NULL
    ),
    (
      4,
      '76561199246758733',
      'tarantool_17',
      'https://steamcommunity.com/profiles/76561199246758733',
      'https://avatars.fastly.steamstatic.com/f0936c98a9f4e938e07a02f06c4cf85d5167e139_full.jpg',
      NULL,
      NULL
    ),
    (
      5,
      '76561198033120969',
      '𝕿𝖍𝖊 𝕷𝖔𝖗𝖉 𝖔𝖋 𝕸𝖎𝖑𝖋𝖘',
      'https://steamcommunity.com/profiles/76561198033120969',
      'https://avatars.fastly.steamstatic.com/d595abc58acfed44cf12721923b08790657b870d_full.jpg',
      'Vladislav',
      'lord_of_milfs'
    ),
    (
      6,
      '76561199586986293',
      'Sedric',
      'https://steamcommunity.com/profiles/76561199586986293',
      'https://avatars.fastly.steamstatic.com/6a991cedbf9caf7e0dfd32c5f17f13820c818bf8_full.jpg',
      NULL,
      NULL
    ),
    (
      7,
      '76561198166439075',
      'Cristiano',
      'https://steamcommunity.com/profiles/76561198166439075',
      'https://avatars.fastly.steamstatic.com/103cbf2f337c4795f9f3b1101c04254d7b920b72_full.jpg',
      NULL,
      NULL
    )
)
UPDATE players
SET
  steam_id64 = seed_profiles.steam_id64,
  steam_persona_name = seed_profiles.steam_persona_name,
  steam_profile_url = seed_profiles.steam_profile_url,
  steam_avatar_url = seed_profiles.steam_avatar_url,
  steam_real_name = seed_profiles.steam_real_name,
  steam_custom_url = seed_profiles.steam_custom_url,
  steam_synced_at = now(),
  updated_at = now()
FROM seed_profiles
WHERE players.id = seed_profiles.player_id;

WITH seed_aliases (player_id, alias_text) AS (
  VALUES
    (3, 'valdemar'),
    (3, 'Vladimir'),
    (4, 'tarantool_17'),
    (5, '𝕿𝖍𝖊 𝕷𝖔𝖗𝖉 𝖔𝖋 𝕸𝖎𝖑𝖋𝖘'),
    (5, '𝕿𝖍𝖊 𝖑𝖔𝖗𝖉 𝖔𝖋 𝖒𝖎𝖑𝖋𝖘'),
    (5, '𓂺𝔻𝕚c𝕜 𝕡𝕚c𓂺'),
    (5, '𓂺𝔻𝕚𝕔𝕜 𝕡𝕚c'),
    (5, '𓂺𝔻𝕚𝕔𝕜 𝕡𝕚'),
    (5, 'lord_of_milfs'),
    (5, 'Vladislav'),
    (6, 'Sedric'),
    (7, 'Cristiano'),
    (7, 'EgorKreed'),
    (7, 'MyNameIsGreatestPro')
),
normalized_seed_aliases AS (
  SELECT DISTINCT ON (player_id, normalized_alias)
    player_id,
    alias_text,
    lower(regexp_replace(btrim(alias_text), '\s+', ' ', 'g')) AS normalized_alias
  FROM seed_aliases
  ORDER BY
    player_id,
    lower(regexp_replace(btrim(alias_text), '\s+', ' ', 'g')),
    length(alias_text),
    alias_text
),
insertable_aliases AS (
  SELECT
    normalized_seed_aliases.player_id,
    normalized_seed_aliases.alias_text,
    normalized_seed_aliases.normalized_alias
  FROM normalized_seed_aliases
  JOIN players ON players.id = normalized_seed_aliases.player_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM player_aliases
    WHERE player_aliases.normalized_alias = normalized_seed_aliases.normalized_alias
      AND player_aliases.status = 'confirmed'
      AND player_aliases.player_id <> normalized_seed_aliases.player_id
  )
)
INSERT INTO player_aliases (player_id, alias_text, normalized_alias, status)
SELECT
  insertable_aliases.player_id,
  insertable_aliases.alias_text,
  insertable_aliases.normalized_alias,
  'confirmed'
FROM insertable_aliases
ON CONFLICT (player_id, normalized_alias) DO UPDATE
SET
  alias_text = EXCLUDED.alias_text,
  status = 'confirmed',
  updated_at = now();
