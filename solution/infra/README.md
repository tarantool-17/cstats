# Local Infrastructure

Run Postgres and the Telegram bot together:

```bash
cp solution/services/api/.env.example solution/services/api/.env
# Fill TELEGRAM_BOT_TOKEN in solution/services/api/.env
docker compose -f solution/infra/docker-compose.yml up --build
```

Stop containers without deleting data:

```bash
docker compose -f solution/infra/docker-compose.yml down
```

Postgres data is stored in the `cstats_postgres-data` Docker volume.
Telegram images are mounted at `/data/images` in the bot container and stored in the `cstats_telegram-images` Docker volume.

Delete all local data only when you intentionally want a reset:

```bash
docker compose -f solution/infra/docker-compose.yml down -v
```
