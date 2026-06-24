# Local Infrastructure

Run Postgres and the Telegram bot together:

```bash
cp api/.env.example api/.env
# Fill TELEGRAM_BOT_TOKEN in api/.env
docker compose -f infra/docker-compose.yml up --build
```

Stop containers without deleting data:

```bash
docker compose -f infra/docker-compose.yml down
```

Postgres data is stored in the `cstats_postgres-data` Docker volume.
Telegram images are mounted at `/data/images` in the bot container and stored in the `cstats_telegram-images` Docker volume.

Delete all local data only when you intentionally want a reset:

```bash
docker compose -f infra/docker-compose.yml down -v
```
