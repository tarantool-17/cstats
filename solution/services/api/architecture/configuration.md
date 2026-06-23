# API Configuration

## Telegram

Telegram configuration should come from environment variables:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_MODE=polling
TELEGRAM_POLLING_TIMEOUT_SECONDS=10
TELEGRAM_ALLOWED_CHAT_IDS
TELEGRAM_ADMIN_USER_IDS
```

For development, `TELEGRAM_POLLING_TIMEOUT_SECONDS` should default to `10`. Production can use a longer timeout, such as `30`, if polling remains enabled there.

The first implementation should use polling only.

## Future Webhook Configuration

Webhook mode can be added later with:

```text
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_URL
TELEGRAM_WEBHOOK_SECRET
```

Webhook mode should use a secret path or header so random callers cannot post fake updates.

## Access Control

`TELEGRAM_ALLOWED_CHAT_IDS` controls where the bot responds.

`TELEGRAM_ADMIN_USER_IDS` controls who can perform admin actions such as resolving review tasks, creating players, merging aliases, rejecting screenshots, or committing corrected matches.

## Shared Service Configuration

The API service also needs configuration for:

- PostgreSQL connection
- local image storage root
- extraction job retry settings
- command audit logging
