# Database Service Architecture

## Responsibility

The database service owns PostgreSQL schema, migrations, constraints, and queue tables. It is the durable coordination point for the API service and extraction worker.

## Owned Data Areas

- source messages
- image assets
- extraction jobs
- extraction results
- review tasks
- canonical players
- player aliases
- committed matches
- match evidence
- per-player match statistics
- command audit logs

## Core Tables

```text
source_messages
image_assets
extraction_jobs
match_extractions
match_extraction_players
review_tasks
players
player_aliases
matches
match_evidence
match_player_stats
command_audit_log
```

## Queue Design

Use PostgreSQL as the async job queue.

`extraction_jobs` should include:

- `id`
- `image_asset_id`
- `status`: `queued`, `processing`, `completed`, `failed`, `cancelled`
- `attempt_count`
- `available_at`
- `locked_at`
- `locked_by`
- `last_error`
- `created_at`
- `updated_at`

Workers claim jobs with row locking. Failed jobs can be retried with backoff.

## Migration Application

Local Docker Compose runs a short-lived `migrate` service after PostgreSQL becomes healthy.
The service applies SQL files from `database/migrations` before the API and extraction worker start.

## Idempotency Constraints

Transport idempotency:

```text
source_messages(platform, external_channel_id, external_message_id)
```

Exact image idempotency:

```text
image_assets(sha256)
```

Committed match idempotency:

```text
matches(fingerprint)
```

Evidence linking:

```text
match_evidence(match_id, source_message_id)
match_evidence(match_id, image_asset_id)
```

The match fingerprint is source-independent and must not include adapter or channel fields.

## Image Asset Storage

Image bytes are stored on local disk. PostgreSQL stores metadata only:

- `relative_path`
- `sha256`
- `perceptual_hash`
- `width`
- `height`
- `mime_type`
- source message link

The path should be relative to a configured image root so local, Docker, and backup layouts can differ without changing database rows.

## Review Data

Review tasks should support:

- unknown nickname resolution
- low-confidence OCR field clarification
- duplicate or correction decisions
- reject screenshot decisions

Each task should record:

- originating source message/channel
- required admin action
- current status
- selected decision
- acting admin
- timestamps

## Read Models

Start with SQL views for aggregate commands:

- all-time player stats
- recent player stats
- MVP leaderboard
- map stats

Materialized views can be added later if command latency becomes a problem.
