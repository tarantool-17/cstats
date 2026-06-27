ALTER TABLE match_extractions
  ADD COLUMN IF NOT EXISTS played_at timestamptz;

CREATE INDEX IF NOT EXISTS match_extractions_played_at_idx
  ON match_extractions (played_at DESC)
  WHERE duplicate_of_match_extraction_id IS NULL;
