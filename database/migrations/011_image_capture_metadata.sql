ALTER TABLE image_assets
  ADD COLUMN IF NOT EXISTS source_file_name text,
  ADD COLUMN IF NOT EXISTS telegram_file_path text,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz;

CREATE INDEX IF NOT EXISTS image_assets_captured_at_idx
  ON image_assets (captured_at DESC)
  WHERE captured_at IS NOT NULL;
