CREATE TABLE IF NOT EXISTS source_messages (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform text NOT NULL,
  external_channel_id text NOT NULL,
  external_message_id text NOT NULL,
  external_sender_id text,
  sender_username text,
  sender_display_name text,
  message_text text,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_channel_id, external_message_id)
);

CREATE TABLE IF NOT EXISTS image_assets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_message_id integer NOT NULL REFERENCES source_messages(id),
  relative_path text NOT NULL,
  sha256 text NOT NULL UNIQUE,
  perceptual_hash text,
  width integer,
  height integer,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extraction_jobs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_asset_id integer NOT NULL UNIQUE REFERENCES image_assets(id),
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS extraction_jobs_claim_idx
  ON extraction_jobs (status, available_at, id);
