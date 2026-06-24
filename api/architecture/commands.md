# Command Architecture

## Responsibility

Commands answer user requests from committed match data.

Command parsing can be channel-specific, but command execution should be channel-neutral.

## Flow

```text
Telegram message text
  -> telegram-command-adapter.ts
  -> command-router.ts
  -> command handler
  -> OutboundMessage
  -> telegram-response-renderer.ts
```

The command router should return structured results instead of Telegram-formatted strings where practical. Renderers can then choose Markdown, plain text, or inline buttons without pushing channel formatting into domain services.

## Initial Commands

- `/help`
- `/top10`
- `/top10 kills`
- `/top10 winrate`
- `/mvp`
- `/mvp 30d`
- `/stats <nickname>`
- `/lastmatch`
- `/pending`
- `/player <display-name> [primary-alias]`
- `/alias <new-alias> <existing-alias>`

## Rules

- Public stats commands read committed matches only.
- Admin commands must check configured admin identities.
- Commands should log enough context for audit and debugging.
- Commands should not trigger OCR work directly.

## Alias Command

`/player <display-name> [primary-alias]` is an admin command for creating a
canonical player plus their first confirmed alias in one transaction. When
`primary-alias` is omitted, the display name is used as the primary alias.

`/alias <new-alias> <existing-alias>` is an admin command for linking OCR variants
or changed nicknames to an existing canonical player. The existing alias must
already be confirmed. The command inserts a new confirmed alias for the same
player, and database triggers retroactively resolve matching unresolved stat rows.
