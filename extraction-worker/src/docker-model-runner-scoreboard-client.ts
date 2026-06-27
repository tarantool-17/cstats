import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ScoreboardModelConfig } from './config.js';
import { normalizeScoreboardExtraction, type ScoreboardExtraction } from './scoreboard-extraction.js';

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export class DockerModelRunnerScoreboardClient {
  constructor(private readonly config: ScoreboardModelConfig) {}

  async extract(imagePath: string): Promise<ScoreboardExtraction> {
    const body = {
      model: this.config.modelName,
      messages: [
        {
          role: 'system',
          content: [
            'You are a strict OCR extraction engine for Counter-Strike 2 scoreboard screenshots.',
            'Return valid JSON only. Do not include markdown, commentary, or guessed values.',
            'Use null when a field is unreadable.'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: SCOREBOARD_PROMPT
            },
            {
              type: 'image_url',
              image_url: {
                url: await readImageDataUrl(imagePath)
              }
            }
          ]
        }
      ],
      max_tokens: this.config.maxTokens,
      temperature: 0,
      response_format: {
        type: 'json_object'
      },
      stream: false
    };

    const response = await fetch(chatCompletionsUrl(this.config.endpointUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Docker Model Runner request failed: ${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    const parsed = parseModelContent(content);

    return normalizeScoreboardExtraction(parsed);
  }
}

const SCOREBOARD_PROMPT = [
  'Extract only the central CS2 match scoreboard table from this image.',
  'Ignore XP/rank banners, player cards at the bottom, background characters, chat text, medals, and rank progress UI.',
  'The scoreboard may use Russian labels:',
  '- "Соревновательный | <map>" is the map header.',
  '- "СПЕЦНАЗ" means CT.',
  '- "ТЕРРОРИСТЫ" means T.',
  '- "Убийства" means kills.',
  '- "Смерти" means deaths.',
  '- "Помощь" means assists.',
  '- "УСП" is adrOrKast.',
  '- "УРОН" means damage.',
  'Return JSON with exactly this shape:',
  '{',
  '  "mapName": string | null,',
  '  "ctScore": number | null,',
  '  "tScore": number | null,',
  '  "players": [',
  '    {',
  '      "team": "CT" | "T" | "unknown",',
  '      "rawNickname": string | null,',
  '      "kills": number | null,',
  '      "deaths": number | null,',
  '      "assists": number | null,',
  '      "adrOrKast": number | null,',
  '      "damage": number | null',
  '    }',
  '  ],',
  '  "confidence": number | null,',
  '  "warnings": string[]',
  '}',
  'Rules:',
  '- Preserve player nicknames exactly as visible.',
  '- Return ten players when the table is readable.',
  '- Put the upper team rows first, then the lower team rows.',
  '- In a standard ten-player board, the upper blue rows are CT and the lower yellow rows are T.',
  '- Identify a player side from their scoreboard row; ignore decorative end-screen banners and background text.',
  '- Do not infer a number from score bars, cards, or kill timeline icons.',
  '- Use null and add a warning when any value is unreadable.'
].join('\n');

async function readImageDataUrl(imagePath: string): Promise<string> {
  const bytes = await readFile(imagePath);
  return `data:${mimeTypeForPath(imagePath)};base64,${bytes.toString('base64')}`;
}

function mimeTypeForPath(imagePath: string): string {
  switch (extname(imagePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
}

function chatCompletionsUrl(endpointUrl: string): string {
  const trimmed = endpointUrl.replace(/\/+$/, '');

  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }

  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/engines/v1/chat/completions`;
}

function parseModelContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return JSON.parse(stripJsonFences(content));
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (isRecord(part) && typeof part.text === 'string') {
          return part.text;
        }

        return '';
      })
      .join('');

    return JSON.parse(stripJsonFences(text));
  }

  throw new Error('Docker Model Runner response did not include text content');
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
