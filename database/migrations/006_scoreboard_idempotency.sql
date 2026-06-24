ALTER TABLE match_extractions
  ADD COLUMN IF NOT EXISTS fingerprint_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS normalized_map_name text,
  ADD COLUMN IF NOT EXISTS exact_fingerprint text,
  ADD COLUMN IF NOT EXISTS unordered_score_key text,
  ADD COLUMN IF NOT EXISTS player_stats_fingerprint text,
  ADD COLUMN IF NOT EXISTS duplicate_of_match_extraction_id integer REFERENCES match_extractions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_match_type text NOT NULL DEFAULT 'unique',
  ADD COLUMN IF NOT EXISTS duplicate_reason text,
  ADD COLUMN IF NOT EXISTS duplicate_match_score integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE match_extractions
    ADD CONSTRAINT match_extractions_duplicate_match_type_check
    CHECK (duplicate_match_type IN (
      'unique',
      'exact_duplicate',
      'strong_fuzzy_duplicate',
      'possible_duplicate'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE match_extractions
    ADD CONSTRAINT match_extractions_duplicate_match_score_check
    CHECK (duplicate_match_score >= 0 AND duplicate_match_score <= 100);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS match_extractions_unique_exact_fingerprint_idx
  ON match_extractions (exact_fingerprint)
  WHERE exact_fingerprint IS NOT NULL
    AND duplicate_of_match_extraction_id IS NULL;

CREATE INDEX IF NOT EXISTS match_extractions_duplicate_of_idx
  ON match_extractions (duplicate_of_match_extraction_id);

CREATE INDEX IF NOT EXISTS match_extractions_fuzzy_lookup_idx
  ON match_extractions (normalized_map_name, unordered_score_key)
  WHERE duplicate_of_match_extraction_id IS NULL;
