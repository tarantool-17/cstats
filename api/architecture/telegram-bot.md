# Telegram Bot Architecture

## Responsibility

The Telegram adapter is the first channel adapter. It owns Telegram protocol details, then delegates domain work to ingestion, review, command, identity, match, and stats services.

The adapter owns:

- bot startup and shutdown
- long-polling update intake
- Telegram update parsing
- Telegram photo file lookup and download
- conversion into `NormalizedMessage`
- conversion from command text into command-router calls
- rendering command results and review prompts back to Telegram
- inline keyboard callback handling
- callback query acknowledgement

The adapter must not own:

- OCR or image parsing
- player identity decisions
- match commit decisions
- aggregate-stat SQL
- source-independent match fingerprinting

## Runtime Mode

Use polling for the first implementation.

Polling keeps local development simple because the bot process calls Telegram directly and does not need a public HTTPS endpoint. Development polling should use a 10 second long-polling timeout.

Webhook support can be added later without changing application services if all updates already pass through `telegram-update-handler.ts`.

## Suggested Module Layout

```text
channels/
  telegram/
    telegram.config.ts
    telegram.types.ts
    telegram-api.ts
    telegram-bot.ts
    telegram-update-handler.ts
    telegram-message-normalizer.ts
    telegram-command-adapter.ts
    telegram-review-callbacks.ts
    telegram-file-downloader.ts
    telegram-response-renderer.ts
```

Use Telegram's raw Bot API through `telegram-api.ts` for the first implementation. This avoids runtime framework dependencies and keeps the container image small.

## Update Handling

All incoming Telegram updates should enter through `telegram-update-handler.ts`.

The handler should route:

- text commands to `telegram-command-adapter.ts`
- photo messages to ingestion
- callback queries to `telegram-review-callbacks.ts`
- unsupported updates to a no-op path

The bot should ignore messages from chats that are not explicitly allowed.

After an image is ingested, the bot immediately acknowledges storage. Final extraction results are sent later through queued `outbound_messages` rows created by the worker and dispatched by the API service.

Each allowed Telegram message should receive a Telegram response: command result, image-ingestion result, unsupported-message hint, or processing error.

Docker logs should include `trace_id` equal to the Telegram message id for each major step:

- `telegram_message_received`
- `telegram_message_put_in_db`
- `extractor_in_process`
- `telegram_outbound_ready`
- `telegram_outbound_sent`

## Normalized Message

Telegram messages should be converted before they reach application services:

```text
NormalizedMessage
  platform: telegram
  external_channel_id
  external_message_id
  external_sender_id
  sender_username
  sender_display_name
  message_text
  received_at
  attachments[]
```

For photos, each attachment should include:

```text
NormalizedAttachment
  kind: image
  provider_file_id
  provider_unique_file_id
  width
  height
  file_size
  mime_type
```

The API should keep Telegram ids only for transport idempotency, source evidence, and replies. Telegram ids must not leak into match fingerprints.

## Photo Handling

For a Telegram `photo` message, use the largest available photo size. Later, the adapter can also accept image documents when `mime_type` starts with `image/`.

Telegram file download should be hidden behind `telegram-file-downloader.ts`. The rest of ingestion should receive bytes or a stream without knowing about Telegram Bot API file URLs.

## Review Callbacks

Telegram review prompts should use inline keyboards for common admin decisions:

```text
Unknown nickname: player_123
[Create player] [Merge alias] [Skip player] [Reject screenshot]
```

Callback data must stay compact because Telegram limits callback payload size. Use ids, not embedded data:

```text
review:<task_id>:create
review:<task_id>:skip
review:<task_id>:reject
```

Admin-only actions must check the acting Telegram user id before changing review tasks, aliases, players, matches, or pending extraction state.

After an admin action succeeds, the bot should update or reply to the original prompt so the channel can see the decision and who made it.
