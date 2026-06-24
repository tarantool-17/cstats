CREATE TABLE IF NOT EXISTS outbound_messages (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform text NOT NULL,
  external_channel_id text NOT NULL,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (platform IN ('telegram')),
  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS outbound_messages_claim_idx
  ON outbound_messages (status, available_at, id);
