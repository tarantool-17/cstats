# Ingestion Architecture

## Responsibility

Ingestion turns channel uploads into durable source messages, image assets, and extraction jobs.

It should be channel-neutral after message normalization. Telegram-specific file lookup belongs in the Telegram adapter, while disk storage, hashing, and job creation belong here.

## Inbound Image Flow

1. Channel adapter receives a message.
2. API normalizes platform-specific payload into an internal message.
3. API inserts `source_messages` with a unique transport key.
4. API downloads image attachments.
5. API stores image files on local disk.
6. API inserts `image_assets` with `relative_path`, `sha256`, and optional perceptual hash.
7. API creates an `extraction_jobs` row in PostgreSQL.

If the exact image or final match already exists, API links the new source as additional evidence instead of creating a duplicate match.

## Telegram Photo Flow

1. Normalize the Telegram message.
2. Insert `source_messages` with `(platform, external_channel_id, external_message_id)`.
3. If the source message already exists, stop processing the duplicate update.
4. Download the selected Telegram file.
5. Store image bytes through `disk-image-storage.ts`.
6. Insert or reuse `image_assets` by `sha256`.
7. Create an `extraction_jobs` row unless an existing image or committed match already covers the upload.
8. Send a short acknowledgement in the same chat.

## Idempotency

Ingestion should enforce idempotency at multiple levels:

- source message key: `(platform, external_channel_id, external_message_id)`
- exact image hash: `image_assets(sha256)`
- final committed match fingerprint: `matches(fingerprint)`

Transport ids are only for retry safety and evidence. They must not be part of the final match fingerprint.

## Storage

Image bytes are stored on local disk. PostgreSQL stores metadata only:

- `relative_path`
- `sha256`
- optional perceptual hash
- width and height
- MIME type
- source message link

Paths should be relative to a configured image root.
