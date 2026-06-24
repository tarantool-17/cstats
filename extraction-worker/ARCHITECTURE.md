# Extraction Worker Architecture

## Responsibility

The extraction worker parses CS2 scoreboard images and writes structured extraction results to PostgreSQL.

It should be lightweight, portable, and runnable as a Docker container or regular process. It should have no direct Telegram or Discord dependencies.

## Owned Capabilities

- PostgreSQL job claiming
- image loading from local disk
- scoreboard panel detection
- image preprocessing
- OCR
- structured row parsing
- confidence scoring
- normalized match fingerprint generation
- extraction-result persistence

## Job Flow

1. Claim an available job from PostgreSQL, for example with `FOR UPDATE SKIP LOCKED`.
2. Load the image from `image_assets.relative_path`.
3. Detect the scoreboard panel.
4. Crop and perspective-correct the panel when possible.
5. OCR the relevant regions.
6. Parse map, team scores, player nicknames, and stat columns.
7. Store normalized match fields, raw nickname evidence, and per-player stat columns in PostgreSQL.
8. Mark the job completed, failed, duplicate candidate, or pending review.

## First Worker Skeleton

The first implementation proves queue mechanics before OCR exists:

1. Claim one `queued` job at a time using `FOR UPDATE SKIP LOCKED`.
2. Mark the job `processing`, increment `attempt_count`, and record `locked_by`.
3. Resolve `image_assets.relative_path` under `IMAGE_STORAGE_ROOT`.
4. Confirm the image file exists.
5. Mark the job `completed` when the file is present.
6. Queue a Telegram result message through `outbound_messages`.
7. Mark the job `failed`, store `last_error`, and queue a processing-error message when processing throws.

This skeleton intentionally does not parse scoreboards yet. OCR and extraction-result persistence can replace the file-existence stub without changing the queue claiming contract.

## Parser Input Reality

The first images are Telegram JPEG photos of a monitor, not clean screenshots. The worker must handle:

- 1280x960 JPEGs
- perspective skew
- glare and uneven brightness
- screen moire
- blur
- Russian CS2 UI labels
- duplicate photos of the same scoreboard
- irrelevant UI cards around the scoreboard

## Extraction Contract

The worker writes a normalized payload shaped around:

```text
match:
  map_name
  match_datetime_candidate
  team_a_score
  team_b_score
  scoreboard_bbox
  confidence
players:
  raw_nickname
  normalized_nickname
  team
  kills
  deaths
  assists
  extra_columns
  damage
  field_confidence
fingerprint:
  source_independent_match_fingerprint
review_questions:
  low_confidence_fields
```

The worker should preserve raw nicknames exactly. Identity resolution happens in the API service.
The first persistence pass only links a row to a canonical player when the raw nickname
matches a confirmed alias after normalization.

## Confidence Rules

Each important field should have a confidence score:

- map name
- team score
- player nickname
- kills
- deaths
- assists
- damage
- row-to-player alignment

Low-confidence fields should generate review questions rather than silently guessing.

## Duplicate Handling

The worker should produce a normalized match fingerprint after OCR and normalization.

The fingerprint should use:

- datetime bucket if available
- map name
- team scores
- sorted normalized player names or resolved canonical ids if provided later
- sorted per-player stat rows

The fingerprint must not use platform, channel, message id, sender id, or local image path.

## Testing Fixtures

The sample Telegram images should become parser fixtures. Expected duplicate groups:

- `photo_1_2026-06-23_15-04-53.jpg` and `photo_2_2026-06-23_15-04-53.jpg`
- `photo_3_2026-06-23_15-04-53.jpg` and `photo_4_2026-06-23_15-04-53.jpg`
- `photo_5_2026-06-23_15-04-53.jpg` and `photo_6_2026-06-23_15-04-53.jpg`

The fixture goal is not perfect OCR on day one. The first useful goal is stable panel detection, row segmentation, and honest confidence reporting.
