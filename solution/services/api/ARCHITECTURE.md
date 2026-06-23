# API Service Architecture

## Responsibility

The API service is the chat-facing orchestration service. It receives events from channel adapters, stores images, creates extraction jobs, manages review prompts, commits approved matches, and answers commands.

It should stay responsible for workflow and integration, not OCR-heavy parsing.

## Owned Capabilities

- Telegram bot adapter
- Discord bot adapter
- normalized inbound message model
- image download and disk persistence
- source-message idempotency
- extraction job creation
- same-channel review prompt delivery
- admin action handling
- player identity resolution workflow
- match commit workflow
- aggregate-stat command handling

## Main Modules

```text
api/
  src/
    channels/
      telegram/
      discord/
      normalized-message.ts
    ingestion/
      image-downloader.ts
      ingestion.service.ts
    storage/
      disk-image-storage.ts
    review/
      review-prompt.service.ts
      admin-actions.service.ts
    identity/
      alias-normalizer.ts
      identity-resolution.service.ts
    matches/
      match-commit.service.ts
      match-evidence.service.ts
    commands/
      command-router.ts
      handlers/
    stats/
      stats-query.service.ts
```

## Inbound Image Flow

1. Channel adapter receives a message.
2. API normalizes platform-specific payload into an internal message.
3. API inserts `source_messages` with a unique transport key.
4. API downloads image attachments.
5. API stores image files on local disk.
6. API inserts `image_assets` with `relative_path`, `sha256`, and optional perceptual hash.
7. API creates an `extraction_jobs` row in PostgreSQL.

If the exact image or final match already exists, API links the new source as additional evidence instead of creating a duplicate match.

## Review Flow

Review always goes back through the same channel where the image was uploaded.

Examples:

- unknown nickname: ask admin to create new player, merge alias, skip participant, or reject screenshot
- unclear OCR field: ask admin to choose between candidate values, enter manually, or reject screenshot
- near-duplicate conflict: ask admin whether this is duplicate evidence, correction, or separate match

Only configured admins can perform final include, merge, skip, reject, or correction actions.

## Command Flow

Commands read committed matches only.

Initial commands:

- `/top10`
- `/top10 kills`
- `/top10 winrate`
- `/mvp`
- `/mvp 30d`
- `/stats <nickname>`
- `/lastmatch`
- `/pending`
- `/merge <alias> <player>`

## Dependencies

- PostgreSQL
- local image folder mounted on the same host or volume as the extraction worker
- Telegram Bot API
- Discord API

## Service Boundaries

The API service should not:

- run OCR directly in request handlers
- depend on parser internals beyond the extraction result contract
- store final stats before required identity review is complete
- include platform identifiers in match fingerprints
