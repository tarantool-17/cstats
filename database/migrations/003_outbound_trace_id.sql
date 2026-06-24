ALTER TABLE outbound_messages
  ADD COLUMN IF NOT EXISTS trace_id text;

CREATE INDEX IF NOT EXISTS outbound_messages_trace_id_idx
  ON outbound_messages (trace_id);
