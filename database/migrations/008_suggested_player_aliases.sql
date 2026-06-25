INSERT INTO players (id, display_name)
OVERRIDING SYSTEM VALUE
VALUES
  (3, 'valdemar'),
  (4, 'tarantool_17'),
  (5, 'The Lord of Milfs'),
  (6, 'Sedric'),
  (7, 'Cristiano')
ON CONFLICT (id) DO NOTHING;

WITH seed_aliases (player_id, alias_text, normalized_alias) AS (
  VALUES
    (3, 'Valdemap', 'valdemap'),
    (3, 'Valdeman', 'valdeman'),
    (3, 'Valdemnr', 'valdemnr'),
    (3, 'Valdemor', 'valdemor'),
    (3, 'Valdeinar', 'valdeinar'),
    (3, 'Valdemdr', 'valdemdr'),
    (3, 'Voldemar', 'voldemar'),
    (3, 'Valdernan', 'valdernan'),
    (3, 'Valdemer', 'valdemer'),
    (3, 'VaIdemar', 'vaidemar'),
    (4, 'tarantool17', 'tarantool17'),
    (4, 'tarantoo1_17', 'tarantoo1_17'),
    (4, 'tarantool_l7', 'tarantool_l7'),
    (4, 'tarantool-17', 'tarantool-17'),
    (4, 'tarantool 17', 'tarantool 17'),
    (4, 'tarant0ol_17', 'tarant0ol_17'),
    (4, 'taranto0l_17', 'taranto0l_17'),
    (4, 'tarantool_I7', 'tarantool_i7'),
    (4, 'tarantooI_17', 'tarantooi_17'),
    (4, 'tarantool_1T', 'tarantool_1t'),
    (5, 'The Lord of Milf', 'the lord of milf'),
    (5, 'The Lord of Mils', 'the lord of mils'),
    (5, 'The Lord of Milfe', 'the lord of milfe'),
    (5, 'The Lord of Mi1fs', 'the lord of mi1fs'),
    (5, 'The Lord of MiIfs', 'the lord of miifs'),
    (5, 'The Lord of Milts', 'the lord of milts'),
    (5, 'The Lord of Mills', 'the lord of mills'),
    (5, 'The Lord of Mifls', 'the lord of mifls'),
    (5, 'The Lord of Mlifs', 'the lord of mlifs'),
    (5, 'The Lord of Milse', 'the lord of milse'),
    (6, 'Cedric', 'cedric'),
    (6, 'Sedrik', 'sedrik'),
    (6, 'Sadrik', 'sadrik'),
    (6, 'Sedrlc', 'sedrlc'),
    (6, 'Sadrlc', 'sadrlc'),
    (6, 'Sedr1c', 'sedr1c'),
    (6, 'Sadr1c', 'sadr1c'),
    (6, 'Sednc', 'sednc'),
    (6, 'Sadnc', 'sadnc'),
    (6, 'Sediric', 'sediric'),
    (7, 'Christiano', 'christiano'),
    (7, 'Cristino', 'cristino'),
    (7, 'Cristianno', 'cristianno'),
    (7, 'Cristian0', 'cristian0'),
    (7, 'Cristianoo', 'cristianoo'),
    (7, 'Crisitano', 'crisitano'),
    (7, 'Cristiaro', 'cristiaro'),
    (7, 'Crlstiano', 'crlstiano'),
    (7, 'Cristianc', 'cristianc'),
    (7, 'Cristlano', 'cristlano')
),
deduped_aliases AS (
  SELECT DISTINCT ON (player_id, normalized_alias)
    player_id,
    alias_text,
    normalized_alias
  FROM seed_aliases
  ORDER BY
    player_id,
    normalized_alias,
    length(alias_text),
    alias_text
)
INSERT INTO player_aliases (player_id, alias_text, normalized_alias, status)
SELECT
  deduped_aliases.player_id,
  deduped_aliases.alias_text,
  deduped_aliases.normalized_alias,
  'suggested'
FROM deduped_aliases
JOIN players ON players.id = deduped_aliases.player_id
ON CONFLICT (player_id, normalized_alias) DO UPDATE
SET
  alias_text = CASE
    WHEN player_aliases.status = 'confirmed' THEN player_aliases.alias_text
    ELSE EXCLUDED.alias_text
  END,
  status = CASE
    WHEN player_aliases.status = 'confirmed' THEN player_aliases.status
    ELSE EXCLUDED.status
  END,
  updated_at = CASE
    WHEN player_aliases.status = 'confirmed' THEN player_aliases.updated_at
    ELSE now()
  END;
