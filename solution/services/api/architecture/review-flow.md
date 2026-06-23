# Review Flow Architecture

## Responsibility

Review flow turns uncertain extraction results into explicit admin decisions before a match is committed.

Review always goes back through the same channel where the image was uploaded.

## Review Cases

- unknown nickname: ask admin to create new player, merge alias, skip participant, or reject screenshot
- unclear OCR field: ask admin to choose between candidate values, enter manually, or reject screenshot
- near-duplicate conflict: ask admin whether this is duplicate evidence, correction, or separate match

Only configured admins can perform final include, merge, skip, reject, or correction actions.

## Prompt Rendering

Review services should produce channel-neutral prompt models. The Telegram adapter renders them as messages with inline keyboards.

Example:

```text
Unknown nickname: player_123
[Create player] [Merge alias] [Skip player] [Reject screenshot]
```

Actions that require free-text input, such as merging an alias into a specific canonical player, can start with an inline button and then ask the admin to reply with the target player name or use `/merge <alias> <player>`.

## Commit Rule

The API must not store final stats before required identity review is complete.

Once all required review tasks are resolved, the match commit service can write:

- committed match
- match evidence
- per-player match stats
- alias changes approved during review
