# API Service Architecture

## Responsibility

The API service is the chat-facing orchestration service. It receives events from channel adapters, stores images, creates extraction jobs, manages review prompts, commits approved matches, and answers commands.

It owns workflow and integration. It should not perform OCR-heavy parsing directly.

## Owned Capabilities

- Telegram bot adapter
- future Discord bot adapter
- normalized inbound message model
- image download and disk persistence
- source-message idempotency
- extraction job creation
- same-channel review prompt delivery
- queued outbound message dispatch
- admin action handling
- player identity resolution workflow
- match commit workflow
- aggregate-stat command handling

## Detailed Architecture

- [Telegram bot](architecture/telegram-bot.md)
- [Ingestion](architecture/ingestion.md)
- [Commands](architecture/commands.md)
- [Review flow](architecture/review-flow.md)
- [Configuration](architecture/configuration.md)

## Main Modules

```text
api/
  src/
    channels/
      telegram/
      discord/
      normalized-message.ts
      outbound-message.ts
    ingestion/
    storage/
    review/
    outbound/
    identity/
    matches/
    commands/
    stats/
```

## Dependencies

- PostgreSQL
- local image folder mounted on the same host or volume as the extraction worker
- Telegram Bot API
- Discord API, later

## Service Boundaries

The API service should not:

- run OCR directly in request handlers
- depend on parser internals beyond the extraction result contract
- store final stats before required identity review is complete
- include platform identifiers in match fingerprints

## First Telegram Milestone

1. Create the API service skeleton and Telegram polling adapter.
2. Implement `/help` and `/pending` with stubbed or simple backing data.
3. Accept Telegram photo messages from allowed chats only.
4. Persist source messages, downloaded image files, image metadata, and extraction jobs.
5. Reply in-channel when an image is accepted, duplicated, rejected, or queued.
6. Dispatch worker result or processing-error messages back to the source channel.
7. Render pending review tasks with inline admin buttons.
8. Enforce admin checks on callback actions.
9. Add `/top10` and `/stats <nickname>` once committed-match read models exist.
