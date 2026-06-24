# Local Infrastructure

Run Postgres, migrations, the Telegram bot, and the extraction worker together:

```bash
cp api/.env.example api/.env
# Fill TELEGRAM_BOT_TOKEN in api/.env
docker compose -f infra/docker-compose.yml up --build
```

Startup order:

1. `postgres` starts and becomes healthy.
2. `migrate` applies every SQL file in `database/migrations`.
3. `telegram-bot` starts after migrations succeed.
4. `extraction-worker` starts after migrations succeed and claims queued jobs.

Stop containers without deleting data:

```bash
docker compose -f infra/docker-compose.yml down
```

Postgres data is stored in the `cstats_postgres-data` Docker volume.
Telegram images are mounted at `/data/images` in the bot container and stored in the `cstats_telegram-images` Docker volume.
The extraction worker mounts the same image volume read-only.

Delete all local data only when you intentionally want a reset:

```bash
docker compose -f infra/docker-compose.yml down -v
```
