# Local Infrastructure

Run Postgres, migrations, the Telegram bot, Docker Model Runner scoreboard OCR, the extraction worker, and the local image browser together:

```bash
cp api/.env.example api/.env
# Fill TELEGRAM_BOT_TOKEN in api/.env
docker compose -f infra/docker-compose.yml up --build
```

Startup order:

1. `postgres` starts and becomes healthy.
2. `migrate` applies every SQL file in `database/migrations`.
3. `telegram-bot` starts after migrations succeed and dispatches queued outbound Telegram messages.
4. Docker Model Runner makes `ai/qwen3-vl:8B-Q8_K_XL` available to `extraction-worker`.
5. `extraction-worker` starts after migrations succeed, claims queued jobs, calls the local vision model, and queues extraction summaries.
6. `web` starts after migrations succeed and serves the uploaded match list at http://localhost:1969.

The worker receives the model endpoint through Compose model variables:

- `SCOREBOARD_MODEL_URL`
- `SCOREBOARD_MODEL_NAME`

Docker Desktop must have Docker Model Runner enabled and the local model available. The current Compose file uses:

```text
ai/qwen3-vl:8B-Q8_K_XL
```

Stop containers without deleting data:

```bash
docker compose -f infra/docker-compose.yml down
```

Postgres data is stored in the `cstats_postgres-data` Docker volume.
Telegram images are mounted at `/data/images` in the bot container and stored in the `cstats_telegram-images` Docker volume.
The extraction worker mounts the same image volume read-only.
The web service mounts the same image volume read-only and lists unique images from `image_assets`, newest first.

Delete all local data only when you intentionally want a reset:

```bash
docker compose -f infra/docker-compose.yml down -v
```
